import "dotenv/config";
import bcrypt from "bcryptjs";
import { supabase } from "./config/supabase.js";

const email = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
if (!email || !process.env.SUPER_ADMIN_PASSWORD) throw new Error("Super Admin seed values are required");
const {error}=await supabase.from("users").upsert({name:process.env.SUPER_ADMIN_NAME||"WebMatrix Owner",email,password_hash:await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD,12),role:"super_admin",status:"active"},{onConflict:"email"}); if(error)throw error;
await supabase.from("site_settings").upsert({singleton:"main"},{onConflict:"singleton"});
console.log(`Super Admin ready: ${email}`);
