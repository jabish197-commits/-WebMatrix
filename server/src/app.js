import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import bcrypt from "bcryptjs";
import multer from "multer";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { supabase } from "./config/supabase.js";
import { allowRoles, authenticate, requirePermission, signToken } from "./auth.js";
import { sendEmail } from "./services/emailService.js";
import { validateEmail } from "./validators/emailValidator.js";

const app = express();
const imageUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter(_req,file,callback){const allowed=["image/jpeg","image/png","image/webp","image/gif","image/svg+xml"],valid=allowed.includes(file.mimetype);callback(valid?null:new Error("Only JPG, PNG, WebP, GIF, and SVG images are allowed"),valid);}});
app.use(helmet());
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());
const isWebMatrixVercelOrigin = (origin) => {
  try {
    const url = new URL(origin);
    return url.protocol === "https:"
      && url.hostname.endsWith(".vercel.app")
      && (
        url.hostname === "web-matrix-delta.vercel.app"
        || url.hostname.startsWith("web-matrix-")
        || url.hostname.startsWith("webmatrix-")
      );
  } catch {
    return false;
  }
};
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    const isLocalDevelopment = process.env.NODE_ENV !== "production"
      && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
    if (!origin || allowedOrigins.includes(origin) || isLocalDevelopment || isWebMatrixVercelOrigin(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

const safeUser = (user) => ({
  id: user.id, name: user.name, email: user.email, role: user.role,
  permissions: user.permissions, status: user.status
});
const welcomeFor = (user) =>
  user.role === "customer"
    ? `Welcome ${user.name}. Enjoy shopping with WebMatrix.`
    : "";
const isSafeOfferLink = (value) => /^(#[A-Za-z0-9_-]+|\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/i.test(String(value || ""));

app.get("/api/health", (_req, res) => res.json({ status: "ok", name: "WebMatrix API" }));

app.post("/api/uploads/image",authenticate,allowRoles("super_admin","admin"),requirePermission("catalog.manage"),imageUpload.single("image"),async(req,res,next)=>{try{if(!req.file)return res.status(400).json({message:"Select an image to upload"});const folder=String(req.body.folder||"general").replace(/[^a-z0-9-]/gi,"").slice(0,30)||"general",extension=(req.file.originalname.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"");const path=`${folder}/${Date.now()}-${randomUUID()}.${extension}`;const{error}=await supabase.storage.from("webmatrix-assets").upload(path,req.file.buffer,{contentType:req.file.mimetype,cacheControl:"31536000",upsert:false});if(error)throw error;const{data}=supabase.storage.from("webmatrix-assets").getPublicUrl(path);res.status(201).json({url:data.publicUrl,path});}catch(error){next(error);}});

app.delete("/api/uploads/image",authenticate,allowRoles("super_admin","admin"),requirePermission("catalog.manage"),async(req,res,next)=>{try{const rawUrl=String(req.body.url||""),marker="/storage/v1/object/public/webmatrix-assets/",markerIndex=rawUrl.indexOf(marker);if(markerIndex<0)return res.status(400).json({message:"This is not a WebMatrix uploaded image"});const path=decodeURIComponent(rawUrl.slice(markerIndex+marker.length).split("?")[0]);if(!path||path.includes(".."))return res.status(400).json({message:"Invalid image path"});const{error}=await supabase.storage.from("webmatrix-assets").remove([path]);if(error)throw error;res.json({message:"Image deleted",path});}catch(error){next(error);}});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !password || password.length < 8) {
      return res.status(400).json({ message: "Name, email, and a password of at least 8 characters are required" });
    }
    const emailResult = validateEmail(email);
    if (!emailResult.valid) return res.status(400).json({ message: emailResult.message });
    const normalizedEmail=emailResult.email;
    const { data:existing }=await supabase.from("users").select("id").eq("email",normalizedEmail).maybeSingle();
    if (existing) return res.status(409).json({ message: "Email is already registered" });
    const { error }=await supabase.from("users").insert({ name, email:normalizedEmail, password_hash:await bcrypt.hash(password,12), role:"customer" });
    if(error) throw error;
    res.status(201).json({ message: "Registration successful. Please log in." });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const emailResult = validateEmail(req.body.email);
    if (!emailResult.valid) return res.status(400).json({ message: emailResult.message });
    const { data:user,error }=await supabase.from("users").select("*").eq("email",emailResult.email).maybeSingle();
    if(error) throw error;
    if (!user || !(await bcrypt.compare(req.body.password || "", user.password_hash))) return res.status(401).json({ message: "Invalid email or password" });
    if (user.status !== "active") return res.status(403).json({ message: "Account is suspended" });
    res.json({ token: signToken(user), user: safeUser(user), welcomeMessage:welcomeFor(user) });
  } catch (error) { next(error); }
});

app.post("/api/auth/forgot-password", async (req, res, next) => {
  try {
    const emailResult = validateEmail(req.body.email);
    if (!emailResult.valid) return res.status(400).json({ message: emailResult.message });
    const email = emailResult.email;
    const genericMessage = "If an active WebMatrix account uses that email, a reset link has been sent.";
    const { data: user, error } = await supabase.from("users").select("id,name,email,status").eq("email", email).maybeSingle();
    if (error) throw error;
    if (!user || user.status !== "active") return res.json({ message: genericMessage });
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await supabase.from("password_reset_tokens").update({ used_at: new Date().toISOString() }).eq("user_id", user.id).is("used_at", null);
    const { data: tokenRow, error: insertError } = await supabase.from("password_reset_tokens").insert({ user_id: user.id, token_hash: tokenHash, expires_at: expiresAt }).select("id").single();
    if (insertError) throw insertError;
    const clientUrl = (process.env.CLIENT_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
    const resetUrl = `${clientUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
    try {
      await sendEmail({
        to: user.email,
        subject: "Reset your WebMatrix password",
        text: `Hello ${user.name}, reset your WebMatrix password using this one-time link within 30 minutes: ${resetUrl}`,
        html: `<div style="background:#f3f5f8;padding:32px 16px;font-family:Arial,sans-serif;color:#152018"><div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e3e7e3;border-radius:18px;padding:32px"><div style="font-size:24px;font-weight:800;margin-bottom:28px">Web<span style="color:#6d5dfc">Matrix</span></div><h1 style="font-size:28px;margin:0 0 16px">Reset your password</h1><p style="line-height:1.6">Hello ${String(user.name).replace(/[<>&"]/g, "")},</p><p style="line-height:1.6">Click the button below to create a new password. This secure link expires in 30 minutes and works only once.</p><p style="margin:28px 0"><a href="${resetUrl}" style="display:inline-block;padding:14px 22px;background:#18251b;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">Reset password</a></p><p style="font-size:13px;line-height:1.5;color:#687269">If you did not request this change, ignore this email. Your current password will remain unchanged.</p></div></div>`,
      });
    } catch (emailError) {
      await supabase.from("password_reset_tokens").delete().eq("id", tokenRow.id);
      throw emailError;
    }
    res.json({ message: genericMessage });
  } catch (error) { next(error); }
});

app.post("/api/auth/reset-password", async (req, res, next) => {
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ message: "This reset link is invalid" });
    if (password.length < 8) return res.status(400).json({ message: "Password must contain at least 8 characters" });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { data: resetToken, error } = await supabase.from("password_reset_tokens").select("id,user_id,expires_at,used_at").eq("token_hash", tokenHash).maybeSingle();
    if (error) throw error;
    if (!resetToken || resetToken.used_at || new Date(resetToken.expires_at) <= new Date()) return res.status(400).json({ message: "This reset link is invalid or has expired" });
    const passwordHash = await bcrypt.hash(password, 12);
    const { error: updateError } = await supabase.from("users").update({ password_hash: passwordHash, updated_at: new Date().toISOString() }).eq("id", resetToken.user_id);
    if (updateError) throw updateError;
    const { error: consumeError } = await supabase.from("password_reset_tokens").update({ used_at: new Date().toISOString() }).eq("user_id", resetToken.user_id).is("used_at", null);
    if (consumeError) throw consumeError;
    res.json({ message: "Password reset successful. You can now sign in." });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", authenticate, (req, res) => res.json({ user: safeUser(req.user) }));

app.get("/api/settings/public", async (_req, res, next) => {
  try { const {data,error}=await supabase.from("site_settings").select("*").eq("singleton","main").single(); if(error)throw error; res.json({...toCamelSettings(data),razorpayConfigured:Boolean(process.env.RAZORPAY_KEY_ID?.trim()&&process.env.RAZORPAY_KEY_SECRET?.trim())}); }
  catch (error) { next(error); }
});

app.get("/api/banners", async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from("banners").select("*").eq("is_active", true).order("position").order("created_at");
    if (error) throw error;
    res.json(data || []);
  } catch (error) { next(error); }
});

app.get("/api/manage/banners", authenticate, allowRoles("super_admin"), async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from("banners").select("*").order("position").order("created_at");
    if (error) throw error;
    res.json(data || []);
  } catch (error) { next(error); }
});

app.post("/api/manage/banners", authenticate, allowRoles("super_admin"), async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim(), imageUrl = String(req.body.image_url || "").trim();
    if (!title || !imageUrl) return res.status(400).json({ message: "Offer title and image are required" });
    const linkUrl = String(req.body.link_url || "#catalog").trim();
    if (!isSafeOfferLink(linkUrl)) return res.status(400).json({ message: "Offer link must be a storefront path, page section, or secure HTTPS URL" });
    const row = { title, image_url: imageUrl, description: String(req.body.description || "").trim(), button_text: String(req.body.button_text || "Shop now").trim(), link_url: linkUrl, background_color: String(req.body.background_color || "#eef5e9"), text_color: String(req.body.text_color || "#152018"), position: Math.max(0, Number(req.body.position) || 0), is_active: req.body.is_active !== false };
    const { data, error } = await supabase.from("banners").insert(row).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) { next(error); }
});

app.patch("/api/manage/banners/:id", authenticate, allowRoles("super_admin"), async (req, res, next) => {
  try {
    const allowed = ["title", "image_url", "description", "button_text", "link_url", "background_color", "text_color", "position", "is_active"];
    const update = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
    if (update.link_url !== undefined && !isSafeOfferLink(update.link_url)) return res.status(400).json({ message: "Offer link must be a storefront path, page section, or secure HTTPS URL" });
    if (update.position !== undefined) update.position = Math.max(0, Number(update.position) || 0);
    const { data, error } = await supabase.from("banners").update(update).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (error) { next(error); }
});

app.delete("/api/manage/banners/:id", authenticate, allowRoles("super_admin"), async (req, res, next) => {
  try {
    const { error } = await supabase.from("banners").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Offer slide deleted" });
  } catch (error) { next(error); }
});

app.patch("/api/settings", authenticate, allowRoles("super_admin", "admin"), async (req, res, next) => {
  try {
    const fields = ["platformName", "logoUrl", "bannerUrl", "backgroundImageUrl", "primaryColor", "accentColor", "textColor", "homeHeading", "homeText", "aboutText", "contactEmail", "merchantUpiId", "storefrontFont", "storefrontTextColor", "storefrontBackgroundColor", "headerBackgroundColor", "heroStartColor", "heroEndColor", "circleColor", "buttonColor", "buttonTextColor", "collectionBackgroundColor", "cardBackgroundColor", "cardBorderColor", "cardBorderStyle", "cardBorderWidth", "cardRadius", "cardsPerRow", "collectionProductLimit", "offerText", "offerBackgroundColor", "offerTextColor", "offerAnimationEnabled", "offerAnimationStyle", "offerAnimationSpeed", "deliveryFee", "freeDeliveryThreshold"];
    const update = Object.fromEntries(fields.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
    if(req.user.role==="admin"&&Object.keys(update).some((key)=>!["deliveryFee","freeDeliveryThreshold"].includes(key)))return res.status(403).json({message:"Admins can update delivery settings only"});
    if(update.deliveryFee!==undefined&&(!Number.isFinite(Number(update.deliveryFee))||Number(update.deliveryFee)<0))return res.status(400).json({message:"Delivery charge must be zero or more"});
    if(update.freeDeliveryThreshold!==undefined&&(!Number.isFinite(Number(update.freeDeliveryThreshold))||Number(update.freeDeliveryThreshold)<0))return res.status(400).json({message:"Free-delivery threshold must be zero or more"});
    if(update.offerAnimationStyle!==undefined&&!['scroll-left','scroll-right','pulse'].includes(update.offerAnimationStyle))return res.status(400).json({message:"Choose a valid offer animation style"});
    if(update.offerAnimationSpeed!==undefined&&(!Number.isFinite(Number(update.offerAnimationSpeed))||Number(update.offerAnimationSpeed)<5||Number(update.offerAnimationSpeed)>60))return res.status(400).json({message:"Offer animation speed must be between 5 and 60 seconds"});
    if (update.merchantUpiId && !/^[\w.-]{2,}@[\w.-]{2,}$/.test(update.merchantUpiId)) return res.status(400).json({ message: "Enter a valid merchant UPI ID, for example shop@bank" });
    const {data:before,error:beforeError}=await supabase.from("site_settings").select("*").eq("singleton","main").single();
    if(beforeError)throw beforeError;
    const dbUpdate=Object.fromEntries(Object.entries(update).map(([key,value])=>[key.replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`),value]));
    const {data,error}=await supabase.from("site_settings").update({...dbUpdate,updated_at:new Date().toISOString()}).eq("singleton","main").select().single();
    if(error)throw error;
    const changes=Object.entries(dbUpdate).filter(([key,value])=>before[key]!==value).map(([field,value])=>({field,from:before[field],to:value}));
    if(changes.length){
      const auditRows=changes.map((change)=>({actor_id:req.user.id,action:"website.setting.updated",resource:"site_settings",resource_id:data.id,metadata:change,ip:req.ip}));
      const {error:auditError}=await supabase.from("audit_logs").insert(auditRows);
      if(auditError)throw auditError;
    }
    res.json(toCamelSettings(data));
  } catch (error) { next(error); }
});

app.get("/api/settings/history",authenticate,allowRoles("super_admin"),async(_req,res,next)=>{
  try{
    const {data:logs,error}=await supabase.from("audit_logs").select("id,actor_id,action,resource,resource_id,metadata,created_at").eq("resource","site_settings").order("created_at",{ascending:false}).limit(50);
    if(error)throw error;
    const actorIds=[...new Set(logs.map((log)=>log.actor_id).filter(Boolean))];
    let actors=[];
    if(actorIds.length){const {data,error:actorsError}=await supabase.from("users").select("id,name,email").in("id",actorIds);if(actorsError)throw actorsError;actors=data;}
    const actorMap=new Map(actors.map((actor)=>[actor.id,actor]));
    res.json(logs.map((log)=>({...log,actor:actorMap.get(log.actor_id)||null})));
  }catch(error){next(error);}
});

app.get("/api/users", authenticate, allowRoles("super_admin", "admin"), requirePermission("customer.view"), async (req, res, next) => {
  try { let query=supabase.from("users").select("id,name,email,role,permissions,status,created_at").order("created_at",{ascending:false}); if(req.user.role==="admin")query=query.eq("role","customer"); const {data,error}=await query;if(error)throw error;res.json(data); }
  catch (error) { next(error); }
});

const editableAdminPermissions = ["catalog.manage", "orders.manage", "customer.view"];

app.post("/api/admins", authenticate, allowRoles("super_admin"), async (req, res, next) => {
  try {
    const { name, email, password, permissions: requestedPermissions = [] } = req.body;
    if (!name || !password || password.length < 8) {
      return res.status(400).json({ message: "Name, email, and a password of at least 8 characters are required" });
    }
    const emailResult = validateEmail(email);
    if (!emailResult.valid) return res.status(400).json({ message: emailResult.message });
    const normalizedEmail = emailResult.email;
    const permissions = editableAdminPermissions.filter((permission) => requestedPermissions.includes(permission));
    const { data: existingAdmin, error: lookupError } = await supabase
      .from("users")
      .select("id,role")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existingAdmin?.role === "super_admin") {
      return res.status(409).json({ message: "This email belongs to a Super Admin and cannot be changed here" });
    }
    if (existingAdmin) {
      const { data: admin, error } = await supabase
        .from("users")
        .update({
          name,
          password_hash: await bcrypt.hash(password, 12),
          role: "admin",
          permissions,
          status: "active",
        })
        .eq("id", existingAdmin.id)
        .select("id,name,email,role,permissions,status")
        .single();
      if (error) throw error;
      return res.json({ ...admin, accountUpdated: true });
    }
    const {data:admin,error}=await supabase.from("users").insert({name,email:normalizedEmail,password_hash:await bcrypt.hash(password,12),role:"admin",permissions}).select("id,name,email,role,permissions,status").single(); if(error)throw error;
    res.status(201).json({ ...admin, accountUpdated: false });
  } catch (error) { next(error); }
});

app.get("/api/admins", authenticate, allowRoles("super_admin"), async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id,name,email,permissions,status,created_at")
      .eq("role", "admin")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (error) { next(error); }
});

app.patch("/api/admins/:id/permissions", authenticate, allowRoles("super_admin"), async (req, res, next) => {
  try {
    const requested = Array.isArray(req.body.permissions) ? req.body.permissions : [];
    const invalid = requested.filter((permission) => !editableAdminPermissions.includes(permission));
    if (invalid.length) return res.status(400).json({ message: `Unknown permission: ${invalid[0]}` });
    const permissions = editableAdminPermissions.filter((permission) => requested.includes(permission));
    const { data, error } = await supabase
      .from("users")
      .update({ permissions, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("role", "admin")
      .select("id,name,email,permissions,status,created_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: "Admin account not found" });
    await supabase.from("audit_logs").insert({
      actor_id: req.user.id,
      action: "admin.permissions.updated",
      resource: "users",
      resource_id: data.id,
      metadata: { permissions },
      ip: req.ip,
    });
    res.json(data);
  } catch (error) { next(error); }
});

const liveDashboard = async (req, res, next) => {
  try {
    res.set("Cache-Control", "private, no-store, max-age=0");
    const isCustomer = req.user.role === "customer";
    let ordersQuery = supabase
      .from("orders")
      .select("id,order_number,status,payment_method,payment_status,total,created_at")
      .order("created_at", { ascending: false });
    if (isCustomer) ordersQuery = ordersQuery.eq("user_id", req.user.id);

    const queries = [ordersQuery];
    if (!isCustomer) {
      queries.push(
        supabase.from("products").select("id,name,stock,price,is_active").eq("is_active", true),
        supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "customer"),
        supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "admin"),
      );
    }

    const [ordersResult, productsResult, customersResult, adminsResult] = await Promise.all(queries);
    for (const result of [ordersResult, productsResult, customersResult, adminsResult].filter(Boolean)) {
      if (result.error) throw result.error;
    }

    const orders = ordersResult.data || [];
    const products = productsResult?.data || [];
    const completedRevenue = orders
      .filter((order) => order.payment_status === "paid" || (order.payment_method === "cod" && order.status === "delivered"))
      .reduce((sum, order) => sum + Number(order.total || 0), 0);
    const pendingOrders = orders.filter((order) => !["delivered", "cancelled"].includes(order.status)).length;
    const recentOrders = orders.slice(0, 6);

    if (isCustomer) {
      return res.json({
        role: req.user.role,
        metrics: {
          totalOrders: orders.length,
          activeOrders: pendingOrders,
          completedOrders: orders.filter((order) => order.status === "delivered").length,
          totalSpent: completedRevenue,
        },
        recentOrders,
      });
    }

    const allLowStockProducts = products
      .filter((product) => Number(product.stock) <= 10)
      .sort((a, b) => Number(a.stock) - Number(b.stock));
    const lowStockProducts = allLowStockProducts.slice(0, 6);
    const inventoryValue = products.reduce(
      (sum, product) => sum + Number(product.price || 0) * Number(product.stock || 0),
      0,
    );
    const salesTrend = Array.from({ length: 7 }, (_, index) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (6 - index));
      const nextDay = new Date(day);
      nextDay.setDate(nextDay.getDate() + 1);
      const dayOrders = orders.filter((order) => {
        const createdAt = new Date(order.created_at);
        return createdAt >= day && createdAt < nextDay;
      });
      return {
        date: day.toISOString(),
        label: day.toLocaleDateString("en-IN", { weekday: "short" }),
        orders: dayOrders.length,
        revenue: dayOrders
          .filter((order) => order.payment_status === "paid" || (order.payment_method === "cod" && order.status === "delivered"))
          .reduce((sum, order) => sum + Number(order.total || 0), 0),
      };
    });
    const inventoryLeaders = [...products]
      .sort((a, b) => Number(b.price) * Number(b.stock) - Number(a.price) * Number(a.stock))
      .slice(0, 5);

    res.json({
      role: req.user.role,
      metrics: {
        revenue: completedRevenue,
        totalOrders: orders.length,
        pendingOrders,
        products: products.length,
        lowStock: allLowStockProducts.length,
        inventoryValue,
        customers: customersResult.count || 0,
        admins: adminsResult.count || 0,
      },
      recentOrders,
      lowStockProducts,
      salesTrend,
      inventoryLeaders,
    });
  } catch (error) {
    next(error);
  }
};
app.get("/api/dashboard", authenticate, liveDashboard);
app.get("/api/dashboard/live", authenticate, liveDashboard);

app.get("/api/categories", async (_req, res, next) => {
  try { const {data,error}=await supabase.from("categories").select("*").eq("is_active",true).order("name");if(error)throw error;res.json(data); }
  catch(error){next(error);}
});

app.get("/api/products", async (req, res, next) => {
  try {
    let query=supabase.from("products").select("*,categories(id,name,slug)").eq("is_active",true).order("created_at",{ascending:false});
    if(req.query.category) query=query.eq("categories.slug",req.query.category);
    if(req.query.featured==="true") query=query.eq("is_featured",true);
    if(req.query.search) query=query.ilike("name",`%${String(req.query.search).slice(0,80)}%`);
    const {data,error}=await query;if(error)throw error;res.json(data);
  } catch(error){next(error);}
});

app.get("/api/products/:id", async (req, res, next) => {
  try { const {data,error}=await supabase.from("products").select("*,categories(id,name,slug)").eq("id",req.params.id).eq("is_active",true).single();if(error)throw error;res.json(data); }
  catch(error){next(error);}
});

const razorpayCredentials = () => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    const error = new Error("Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env");
    error.status = 503;
    throw error;
  }
  return { keyId, keySecret, authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` };
};

async function cartQuote(items) {
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error("Cart is empty"), { status: 400 });
  const normalized = items.map((item) => ({ productId: String(item.productId), quantity: Number(item.quantity) }));
  if (normalized.some((item) => !item.productId || !Number.isInteger(item.quantity) || item.quantity < 1)) throw Object.assign(new Error("Invalid cart items"), { status: 400 });
  const { data: products, error } = await supabase.from("products").select("id,name,price,delivery_fee,stock,is_active").in("id", normalized.map((item) => item.productId));
  if (error) throw error;
  let subtotal = 0;
  let productDelivery = 0;
  for (const item of normalized) {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product?.is_active) throw Object.assign(new Error("A product is unavailable"), { status: 409 });
    if (product.stock < item.quantity) throw Object.assign(new Error(`Insufficient stock for ${product.name}`), { status: 409 });
    subtotal += Number(product.price) * item.quantity;
    productDelivery += Math.max(0,Number(product.delivery_fee??0));
  }
  const {data:deliverySettings,error:settingsError}=await supabase.from("site_settings").select("delivery_fee,free_delivery_threshold").eq("singleton","main").single();
  if(settingsError)throw settingsError;
  const freeDeliveryThreshold=Math.max(0,Number(deliverySettings.free_delivery_threshold??999));
  const shipping = freeDeliveryThreshold>0&&subtotal>=freeDeliveryThreshold ? 0 : productDelivery;
  return { amount: Math.round((subtotal + shipping) * 100), normalized };
}

async function createCommerceOrder(userId, items, address, paymentMethod, notes) {
  const { data: orderId, error } = await supabase.rpc("checkout_order", { p_user_id: userId, p_items: items, p_address: address, p_payment_method: paymentMethod, p_notes: notes });
  if (error) throw error;
  const { data: order, error: orderError } = await supabase.from("orders").select("*,order_items(*)").eq("id", orderId).single();
  if (orderError) throw orderError;
  return order;
}

app.post("/api/payments/razorpay/order", authenticate, allowRoles("customer","admin"), async (req, res, next) => {
  try {
    const credentials = razorpayCredentials();
    const quote = await cartQuote(req.body.items);
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: credentials.authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: quote.amount, currency: "INR", receipt: `wm_${Date.now()}_${randomUUID().slice(0, 8)}`, notes: { customer_id: req.user.id } }),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error?.description || "Razorpay could not create the payment order"), { status: 502 });
    res.json({ keyId: credentials.keyId, orderId: data.id, amount: data.amount, currency: data.currency });
  } catch (error) { next(error); }
});

app.post("/api/payments/razorpay/verify", authenticate, allowRoles("customer","admin"), async (req, res, next) => {
  try {
    const credentials = razorpayCredentials();
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, items, address, notes = "" } = req.body;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) return res.status(400).json({ message: "Incomplete Razorpay payment response" });
    if (!address?.fullName || !address?.phone || !address?.line1 || !address?.city || !address?.state || !address?.postalCode) return res.status(400).json({ message: "Complete delivery address is required" });
    const expected = createHmac("sha256", credentials.keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
    const supplied = Buffer.from(String(razorpaySignature), "hex"), expectedBuffer = Buffer.from(expected, "hex");
    if (supplied.length !== expectedBuffer.length || !timingSafeEqual(supplied, expectedBuffer)) return res.status(400).json({ message: "Payment signature verification failed" });
    const [quote, paymentResponse, gatewayOrderResponse] = await Promise.all([
      cartQuote(items),
      fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpayPaymentId)}`, { headers: { Authorization: credentials.authorization } }),
      fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}`, { headers: { Authorization: credentials.authorization } }),
    ]);
    const payment = await paymentResponse.json(), gatewayOrder = await gatewayOrderResponse.json();
    if (!paymentResponse.ok || !gatewayOrderResponse.ok || gatewayOrder.notes?.customer_id !== req.user.id || payment.order_id !== razorpayOrderId || payment.currency !== "INR" || Number(payment.amount) !== quote.amount || payment.status !== "captured") return res.status(409).json({ message: "Payment is not captured or does not match this order. The order was not created." });
    const { data: existingPayment, error: replayLookupError } = await supabase.from("orders").select("id").eq("gateway_payment_id", razorpayPaymentId).maybeSingle();
    if (replayLookupError) throw replayLookupError;
    if (existingPayment) return res.status(409).json({ message: "This Razorpay payment has already been used" });
    const order = await createCommerceOrder(req.user.id, quote.normalized, address, "online", notes);
    const gatewayReference = payment.acquirer_data?.rrn || payment.acquirer_data?.upi_transaction_id || payment.acquirer_data?.bank_transaction_id || null;
    const gatewayProvider = payment.provider || payment.wallet || (payment.method === "upi" ? "UPI via Razorpay" : payment.method);
    const { error: updateError } = await supabase.from("orders").update({ payment_status: "paid", gateway_order_id: razorpayOrderId, gateway_payment_id: razorpayPaymentId, gateway_provider: gatewayProvider, gateway_reference: gatewayReference, gateway_amount: Number(payment.amount) / 100, gateway_status: payment.status, updated_at: new Date().toISOString() }).eq("id", order.id);
    if (updateError) throw updateError;
    res.status(201).json({ ...order, payment_status: "paid", razorpayPaymentId });
  } catch (error) { next(error); }
});

app.get("/api/manage/products", authenticate, allowRoles("super_admin","admin"), requirePermission("catalog.manage"), async (_req,res,next)=>{
  try{const{data,error}=await supabase.from("products").select("*,categories(id,name)").order("created_at",{ascending:false});if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.post("/api/manage/products", authenticate, allowRoles("super_admin","admin"), requirePermission("catalog.manage"), async (req,res,next)=>{
  try {
    const fields=["name","description","price","stock","delivery_fee","image_url","category_id","is_featured","is_active"];
    const product=Object.fromEntries(fields.filter(k=>req.body[k]!==undefined).map(k=>[k,req.body[k]]));
    if(!product.name||product.price===undefined)return res.status(400).json({message:"Product name and price are required"});
    if(!Number.isFinite(Number(product.delivery_fee))||Number(product.delivery_fee)<0)return res.status(400).json({message:"Delivery charge must be zero or more"});
    product.category_id=product.category_id||null;
    const{data,error}=await supabase.from("products").insert(product).select().single();
    if(error)throw error;
    res.status(201).json(data);
  }catch(error){next(error);}
});

app.patch("/api/manage/products/:id", authenticate, allowRoles("super_admin","admin"), requirePermission("catalog.manage"), async (req,res,next)=>{
  try{const fields=["name","description","price","stock","delivery_fee","image_url","category_id","is_featured","is_active"];const update=Object.fromEntries(fields.filter(k=>req.body[k]!==undefined).map(k=>[k,req.body[k]]));if(update.category_id!==undefined)update.category_id=update.category_id||null;if(update.delivery_fee!==undefined&&(!Number.isFinite(Number(update.delivery_fee))||Number(update.delivery_fee)<0))return res.status(400).json({message:"Delivery charge must be zero or more"});const{data,error}=await supabase.from("products").update({...update,updated_at:new Date().toISOString()}).eq("id",req.params.id).select().single();if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.delete("/api/manage/products/:id", authenticate, allowRoles("super_admin","admin"), requirePermission("catalog.manage"), async (req,res,next)=>{
  try{const{data:product,error}=await supabase.from("products").delete().eq("id",req.params.id).select("id,name,image_url").single();if(error)throw error;if(product.image_url){const marker="/storage/v1/object/public/webmatrix-assets/",index=product.image_url.indexOf(marker);if(index>=0){const path=decodeURIComponent(product.image_url.slice(index+marker.length).split("?")[0]);if(path&&!path.includes(".."))await supabase.storage.from("webmatrix-assets").remove([path]);}}res.json({message:"Product deleted",product});}catch(error){next(error);}
});

app.post("/api/manage/categories", authenticate, allowRoles("super_admin","admin"), requirePermission("catalog.manage"), async (req,res,next)=>{
  try{const{name,slug,description="",image_url=""}=req.body;if(!name||!slug)return res.status(400).json({message:"Name and slug are required"});const{data,error}=await supabase.from("categories").insert({name,slug,description,image_url}).select().single();if(error)throw error;res.status(201).json(data);}catch(error){next(error);}
});

app.post("/api/orders", authenticate, allowRoles("customer","admin"), async (req,res,next)=>{
  try{const{items,address,paymentMethod="cod",notes=""}=req.body;if(paymentMethod!=="cod")return res.status(400).json({message:"Online payments must be completed through the verified Razorpay flow"});if(!Array.isArray(items)||!address?.fullName||!address?.phone||!address?.line1||!address?.city||!address?.state||!address?.postalCode)return res.status(400).json({message:"Cart and complete delivery address are required"});const order=await createCommerceOrder(req.user.id,items,address,"cod",notes);res.status(201).json(order);}catch(error){next(error);}
});

app.post("/api/orders/manual-upi", authenticate, allowRoles("customer","admin"), async (req,res,next)=>{
  try{
    const{items,address,reference:paymentReference,notes=""}=req.body,reference=String(paymentReference||"").trim();
    if(!/^[A-Za-z0-9-]{8,35}$/.test(reference))return res.status(400).json({message:"Invalid payment reference"});
    if(!address?.fullName||!address?.phone||!address?.line1||!address?.city||!address?.state||!address?.postalCode)return res.status(400).json({message:"Complete delivery address is required"});
    const{data:used,error:lookupError}=await supabase.from("orders").select("id").eq("gateway_reference",reference).maybeSingle();if(lookupError)throw lookupError;if(used)return res.status(409).json({message:"This UPI transaction reference has already been submitted"});
    const quote=await cartQuote(items),order=await createCommerceOrder(req.user.id,quote.normalized,address,"online",notes);
    const{error:updateError}=await supabase.from("orders").update({payment_status:"pending",gateway_provider:"Direct UPI",gateway_reference:reference,gateway_amount:quote.amount/100,gateway_status:"payment_launched",updated_at:new Date().toISOString()}).eq("id",order.id);if(updateError)throw updateError;
    res.status(201).json({...order,payment_status:"pending",gateway_reference:reference});
  }catch(error){next(error);}
});

app.get("/api/orders/my", authenticate, allowRoles("customer"), async (req,res,next)=>{
  try{const{data,error}=await supabase.from("orders").select("*,order_items(*)").eq("user_id",req.user.id).order("created_at",{ascending:false});if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.get("/api/manage/orders", authenticate, allowRoles("super_admin","admin"), requirePermission("orders.manage"), async (_req,res,next)=>{
  try{const{data,error}=await supabase.from("orders").select("*,users(name,email),order_items(*)").order("created_at",{ascending:false});if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.post("/api/manage/orders/:id/payment/refresh", authenticate, allowRoles("super_admin","admin"), requirePermission("orders.manage"), async (req,res,next)=>{
  try {
    const credentials=razorpayCredentials();
    const{data:order,error:orderError}=await supabase.from("orders").select("id,gateway_payment_id").eq("id",req.params.id).single();
    if(orderError)throw orderError;
    if(!order.gateway_payment_id)return res.status(400).json({message:"This order has no Razorpay payment"});
    const response=await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(order.gateway_payment_id)}`,{headers:{Authorization:credentials.authorization}}),payment=await response.json();
    if(!response.ok)throw Object.assign(new Error(payment.error?.description||"Unable to refresh Razorpay payment"),{status:502});
    const paymentStatus=payment.status==="captured"?"paid":payment.status==="refunded"?"refunded":payment.status==="failed"?"failed":"pending";
    const gatewayReference=payment.acquirer_data?.rrn||payment.acquirer_data?.upi_transaction_id||payment.acquirer_data?.bank_transaction_id||null;
    const gatewayProvider=payment.provider||payment.wallet||(payment.method==="upi"?"UPI via Razorpay":payment.method);
    const{data:updated,error:updateError}=await supabase.from("orders").update({payment_status:paymentStatus,gateway_status:payment.status,gateway_provider:gatewayProvider,gateway_reference:gatewayReference,gateway_amount:Number(payment.amount)/100,updated_at:new Date().toISOString()}).eq("id",order.id).select().single();
    if(updateError)throw updateError;
    res.json(updated);
  }catch(error){next(error);}
});

app.patch("/api/manage/orders/:id/payment/status", authenticate, allowRoles("super_admin","admin"), requirePermission("orders.manage"), async(req,res,next)=>{
  try{const allowed=["pending","paid","failed","refunded"],status=req.body.status;if(!allowed.includes(status))return res.status(400).json({message:"Invalid payment status"});const{data,error}=await supabase.from("orders").update({payment_status:status,gateway_status:status==="paid"?"manually_verified":status,updated_at:new Date().toISOString()}).eq("id",req.params.id).eq("gateway_provider","Direct UPI").select().single();if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.patch("/api/manage/orders/:id/status", authenticate, allowRoles("super_admin","admin"), requirePermission("orders.manage"), async (req,res,next)=>{
  try{const allowed=["placed","confirmed","packed","shipped","delivered","cancelled"];if(!allowed.includes(req.body.status))return res.status(400).json({message:"Invalid order status"});const{data,error}=await supabase.from("orders").update({status:req.body.status,updated_at:new Date().toISOString()}).eq("id",req.params.id).select().single();if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.use((_req, res) => res.status(404).json({ message: "Route not found" }));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.code === "23505" || error?.code === 11000) return res.status(409).json({ message: "That value already exists" });
  if (error?.code === "P0001") return res.status(400).json({message:error.message});
  if (error?.status) return res.status(error.status).json({ message: error.message });
  res.status(500).json({ message: process.env.NODE_ENV === "production" ? "Internal server error" : error.message || "Internal server error" });
});

export default app;

function toCamelSettings(row){ return { ...row, platformName:row.platform_name, logoUrl:row.logo_url, bannerUrl:row.banner_url, backgroundImageUrl:row.background_image_url, primaryColor:row.primary_color, accentColor:row.accent_color, textColor:row.text_color, homeHeading:row.home_heading, homeText:row.home_text, aboutText:row.about_text, contactEmail:row.contact_email, merchantUpiId:row.merchant_upi_id || "", storefrontFont:row.storefront_font, storefrontTextColor:row.storefront_text_color, storefrontBackgroundColor:row.storefront_background_color, headerBackgroundColor:row.header_background_color, heroStartColor:row.hero_start_color, heroEndColor:row.hero_end_color, circleColor:row.circle_color, buttonColor:row.button_color, buttonTextColor:row.button_text_color, collectionBackgroundColor:row.collection_background_color, cardBackgroundColor:row.card_background_color, cardBorderColor:row.card_border_color, cardBorderStyle:row.card_border_style, cardBorderWidth:row.card_border_width, cardRadius:row.card_radius, cardsPerRow:row.cards_per_row, collectionProductLimit:row.collection_product_limit, offerText:row.offer_text || "LIMITED-TIME OFFER • Shop new arrivals today", offerBackgroundColor:row.offer_background_color || "#e7a93f", offerTextColor:row.offer_text_color || "#152018", offerAnimationEnabled:row.offer_animation_enabled ?? true, offerAnimationStyle:row.offer_animation_style || "scroll-left", offerAnimationSpeed:Number(row.offer_animation_speed ?? 20), deliveryFee:Number(row.delivery_fee??79), freeDeliveryThreshold:Number(row.free_delivery_threshold??999) }; }
