import jwt from "jsonwebtoken";
import { supabase } from "./config/supabase.js";

export const signToken = (user) => jwt.sign(
  { userId: user.id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
);

export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    if (!token) return res.status(401).json({ message: "Authentication required" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { data:user, error } = await supabase.from("users").select("id,name,email,role,permissions,status").eq("id",payload.userId).maybeSingle();
    if (error) throw error;
    if (!user || user.status !== "active") return res.status(401).json({ message: "Account is unavailable" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

export const allowRoles = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: "Access denied" });

export const requirePermission = (permission) => (req, res, next) => {
  if (req.user.role === "super_admin" || req.user.permissions.includes(permission)) return next();
  res.status(403).json({ message: `Missing permission: ${permission}` });
};
