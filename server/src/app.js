import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import bcrypt from "bcryptjs";
import multer from "multer";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { supabase } from "./config/supabase.js";
import { allowRoles, authenticate, requirePermission, signToken } from "./auth.js";

const app = express();
const imageUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter(_req,file,callback){const allowed=["image/jpeg","image/png","image/webp","image/gif","image/svg+xml"],valid=allowed.includes(file.mimetype);callback(valid?null:new Error("Only JPG, PNG, WebP, GIF, and SVG images are allowed"),valid);}});
app.use(helmet());
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    const isLocalDevelopment = process.env.NODE_ENV !== "production"
      && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
    if (!origin || allowedOrigins.includes(origin) || isLocalDevelopment) return callback(null, true);
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

app.get("/api/health", (_req, res) => res.json({ status: "ok", name: "WebMatrix API" }));

app.post("/api/uploads/image",authenticate,allowRoles("super_admin","admin"),imageUpload.single("image"),async(req,res,next)=>{try{if(!req.file)return res.status(400).json({message:"Select an image to upload"});const folder=String(req.body.folder||"general").replace(/[^a-z0-9-]/gi,"").slice(0,30)||"general",extension=(req.file.originalname.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"");const path=`${folder}/${Date.now()}-${randomUUID()}.${extension}`;const{error}=await supabase.storage.from("webmatrix-assets").upload(path,req.file.buffer,{contentType:req.file.mimetype,cacheControl:"31536000",upsert:false});if(error)throw error;const{data}=supabase.storage.from("webmatrix-assets").getPublicUrl(path);res.status(201).json({url:data.publicUrl,path});}catch(error){next(error);}});

app.delete("/api/uploads/image",authenticate,allowRoles("super_admin","admin"),async(req,res,next)=>{try{const rawUrl=String(req.body.url||""),marker="/storage/v1/object/public/webmatrix-assets/",markerIndex=rawUrl.indexOf(marker);if(markerIndex<0)return res.status(400).json({message:"This is not a WebMatrix uploaded image"});const path=decodeURIComponent(rawUrl.slice(markerIndex+marker.length).split("?")[0]);if(!path||path.includes(".."))return res.status(400).json({message:"Invalid image path"});const{error}=await supabase.storage.from("webmatrix-assets").remove([path]);if(error)throw error;res.json({message:"Image deleted",path});}catch(error){next(error);}});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ message: "Name, email, and a password of at least 8 characters are required" });
    }
    const normalizedEmail=email.toLowerCase();
    const { data:existing }=await supabase.from("users").select("id").eq("email",normalizedEmail).maybeSingle();
    if (existing) return res.status(409).json({ message: "Email is already registered" });
    const { error }=await supabase.from("users").insert({ name, email:normalizedEmail, password_hash:await bcrypt.hash(password,12), role:"customer" });
    if(error) throw error;
    res.status(201).json({ message: "Registration successful. Please log in." });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { data:user,error }=await supabase.from("users").select("*").eq("email",req.body.email?.toLowerCase()).maybeSingle();
    if(error) throw error;
    if (!user || !(await bcrypt.compare(req.body.password || "", user.password_hash))) return res.status(401).json({ message: "Invalid email or password" });
    if (user.status !== "active") return res.status(403).json({ message: "Account is suspended" });
    res.json({ token: signToken(user), user: safeUser(user), welcomeMessage:welcomeFor(user) });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", authenticate, (req, res) => res.json({ user: safeUser(req.user) }));

app.get("/api/settings/public", async (_req, res, next) => {
  try { const {data,error}=await supabase.from("site_settings").select("*").eq("singleton","main").single(); if(error)throw error; res.json({...toCamelSettings(data),razorpayConfigured:Boolean(process.env.RAZORPAY_KEY_ID?.trim()&&process.env.RAZORPAY_KEY_SECRET?.trim())}); }
  catch (error) { next(error); }
});

app.patch("/api/settings", authenticate, allowRoles("super_admin"), async (req, res, next) => {
  try {
    const fields = ["platformName", "logoUrl", "bannerUrl", "backgroundImageUrl", "primaryColor", "accentColor", "textColor", "homeHeading", "homeText", "aboutText", "contactEmail", "merchantUpiId", "storefrontFont", "storefrontTextColor", "storefrontBackgroundColor", "headerBackgroundColor", "heroStartColor", "heroEndColor", "circleColor", "buttonColor", "buttonTextColor", "collectionBackgroundColor", "cardBackgroundColor", "cardBorderColor", "cardBorderStyle", "cardBorderWidth", "cardRadius", "cardsPerRow", "collectionProductLimit"];
    const update = Object.fromEntries(fields.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
    if (update.merchantUpiId && !/^[\w.-]{2,}@[\w.-]{2,}$/.test(update.merchantUpiId)) return res.status(400).json({ message: "Enter a valid merchant UPI ID, for example shop@bank" });
    const dbUpdate=Object.fromEntries(Object.entries(update).map(([key,value])=>[key.replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`),value]));
    const {data,error}=await supabase.from("site_settings").update({...dbUpdate,updated_at:new Date().toISOString()}).eq("singleton","main").select().single(); if(error)throw error; res.json(toCamelSettings(data));
  } catch (error) { next(error); }
});

app.get("/api/users", authenticate, allowRoles("super_admin", "admin"), requirePermission("customer.view"), async (req, res, next) => {
  try { let query=supabase.from("users").select("id,name,email,role,permissions,status,created_at").order("created_at",{ascending:false}); if(req.user.role==="admin")query=query.eq("role","customer"); const {data,error}=await query;if(error)throw error;res.json(data); }
  catch (error) { next(error); }
});

app.post("/api/admins", authenticate, allowRoles("super_admin"), async (req, res, next) => {
  try {
    const { name, email, password, permissions = [] } = req.body;
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ message: "Name, email, and a password of at least 8 characters are required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const { data: existingAdmin, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existingAdmin) return res.status(409).json({ message: "A user with this email already exists" });
    const {data:admin,error}=await supabase.from("users").insert({name,email:normalizedEmail,password_hash:await bcrypt.hash(password,12),role:"admin",permissions}).select("id,name,email,role,permissions,status").single(); if(error)throw error;
    res.status(201).json(admin);
  } catch (error) { next(error); }
});

app.get("/api/dashboard", authenticate, (req, res) => res.json({
  message: `Welcome to the ${req.user.role.replace("_", " ")} dashboard`, role: req.user.role
}));

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

app.get("/api/products/:slug", async (req, res, next) => {
  try { const {data,error}=await supabase.from("products").select("*,categories(id,name,slug)").eq("slug",req.params.slug).eq("is_active",true).single();if(error)throw error;res.json(data); }
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
  const { data: products, error } = await supabase.from("products").select("id,name,price,stock,is_active").in("id", normalized.map((item) => item.productId));
  if (error) throw error;
  let subtotal = 0;
  for (const item of normalized) {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product?.is_active) throw Object.assign(new Error("A product is unavailable"), { status: 409 });
    if (product.stock < item.quantity) throw Object.assign(new Error(`Insufficient stock for ${product.name}`), { status: 409 });
    subtotal += Number(product.price) * item.quantity;
  }
  const shipping = subtotal >= 999 ? 0 : 79;
  return { amount: Math.round((subtotal + shipping) * 100), normalized };
}

async function createCommerceOrder(userId, items, address, paymentMethod, notes) {
  const { data: orderId, error } = await supabase.rpc("checkout_order", { p_user_id: userId, p_items: items, p_address: address, p_payment_method: paymentMethod, p_notes: notes });
  if (error) throw error;
  const { data: order, error: orderError } = await supabase.from("orders").select("*,order_items(*)").eq("id", orderId).single();
  if (orderError) throw orderError;
  return order;
}

app.post("/api/payments/razorpay/order", authenticate, allowRoles("customer"), async (req, res, next) => {
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

app.post("/api/payments/razorpay/verify", authenticate, allowRoles("customer"), async (req, res, next) => {
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

app.get("/api/manage/products", authenticate, allowRoles("super_admin","admin"), async (_req,res,next)=>{
  try{const{data,error}=await supabase.from("products").select("*,categories(id,name)").order("created_at",{ascending:false});if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.post("/api/manage/products", authenticate, allowRoles("super_admin","admin"), async (req,res,next)=>{
  try{const fields=["name","slug","description","sku","price","compare_at_price","stock","image_url","images","category_id","is_featured","is_active"];const product=Object.fromEntries(fields.filter(k=>req.body[k]!==undefined).map(k=>[k,req.body[k]]));if(!product.name||!product.slug||!product.sku||product.price===undefined)return res.status(400).json({message:"Name, slug, SKU, and price are required"});const{data,error}=await supabase.from("products").insert(product).select().single();if(error)throw error;res.status(201).json(data);}catch(error){next(error);}
});

app.patch("/api/manage/products/:id", authenticate, allowRoles("super_admin","admin"), async (req,res,next)=>{
  try{const fields=["name","slug","description","sku","price","compare_at_price","stock","image_url","images","category_id","is_featured","is_active"];const update=Object.fromEntries(fields.filter(k=>req.body[k]!==undefined).map(k=>[k,req.body[k]]));const{data,error}=await supabase.from("products").update({...update,updated_at:new Date().toISOString()}).eq("id",req.params.id).select().single();if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.delete("/api/manage/products/:id", authenticate, allowRoles("super_admin","admin"), async (req,res,next)=>{
  try{const{data:product,error}=await supabase.from("products").delete().eq("id",req.params.id).select("id,name,image_url").single();if(error)throw error;if(product.image_url){const marker="/storage/v1/object/public/webmatrix-assets/",index=product.image_url.indexOf(marker);if(index>=0){const path=decodeURIComponent(product.image_url.slice(index+marker.length).split("?")[0]);if(path&&!path.includes(".."))await supabase.storage.from("webmatrix-assets").remove([path]);}}res.json({message:"Product deleted",product});}catch(error){next(error);}
});

app.post("/api/manage/categories", authenticate, allowRoles("super_admin","admin"), async (req,res,next)=>{
  try{const{name,slug,description="",image_url=""}=req.body;if(!name||!slug)return res.status(400).json({message:"Name and slug are required"});const{data,error}=await supabase.from("categories").insert({name,slug,description,image_url}).select().single();if(error)throw error;res.status(201).json(data);}catch(error){next(error);}
});

app.post("/api/orders", authenticate, allowRoles("customer"), async (req,res,next)=>{
  try{const{items,address,paymentMethod="cod",notes=""}=req.body;if(paymentMethod!=="cod")return res.status(400).json({message:"Online payments must be completed through the verified Razorpay flow"});if(!Array.isArray(items)||!address?.fullName||!address?.phone||!address?.line1||!address?.city||!address?.state||!address?.postalCode)return res.status(400).json({message:"Cart and complete delivery address are required"});const order=await createCommerceOrder(req.user.id,items,address,"cod",notes);res.status(201).json(order);}catch(error){next(error);}
});

app.post("/api/orders/manual-upi", authenticate, allowRoles("customer"), async (req,res,next)=>{
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

app.get("/api/manage/orders", authenticate, allowRoles("super_admin","admin"), async (_req,res,next)=>{
  try{const{data,error}=await supabase.from("orders").select("*,users(name,email),order_items(*)").order("created_at",{ascending:false});if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.post("/api/manage/orders/:id/payment/refresh", authenticate, allowRoles("super_admin","admin"), async (req,res,next)=>{
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

app.patch("/api/manage/orders/:id/payment/status", authenticate, allowRoles("super_admin","admin"), async(req,res,next)=>{
  try{const allowed=["pending","paid","failed","refunded"],status=req.body.status;if(!allowed.includes(status))return res.status(400).json({message:"Invalid payment status"});const{data,error}=await supabase.from("orders").update({payment_status:status,gateway_status:status==="paid"?"manually_verified":status,updated_at:new Date().toISOString()}).eq("id",req.params.id).eq("gateway_provider","Direct UPI").select().single();if(error)throw error;res.json(data);}catch(error){next(error);}
});

app.patch("/api/manage/orders/:id/status", authenticate, allowRoles("super_admin","admin"), async (req,res,next)=>{
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

function toCamelSettings(row){ return { ...row, platformName:row.platform_name, logoUrl:row.logo_url, bannerUrl:row.banner_url, backgroundImageUrl:row.background_image_url, primaryColor:row.primary_color, accentColor:row.accent_color, textColor:row.text_color, homeHeading:row.home_heading, homeText:row.home_text, aboutText:row.about_text, contactEmail:row.contact_email, merchantUpiId:row.merchant_upi_id || "", storefrontFont:row.storefront_font, storefrontTextColor:row.storefront_text_color, storefrontBackgroundColor:row.storefront_background_color, headerBackgroundColor:row.header_background_color, heroStartColor:row.hero_start_color, heroEndColor:row.hero_end_color, circleColor:row.circle_color, buttonColor:row.button_color, buttonTextColor:row.button_text_color, collectionBackgroundColor:row.collection_background_color, cardBackgroundColor:row.card_background_color, cardBorderColor:row.card_border_color, cardBorderStyle:row.card_border_style, cardBorderWidth:row.card_border_width, cardRadius:row.card_radius, cardsPerRow:row.cards_per_row, collectionProductLimit:row.collection_product_limit }; }
