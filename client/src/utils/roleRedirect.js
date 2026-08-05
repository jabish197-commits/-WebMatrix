export const roleRedirect = (role) => ({ super_admin:"/super-admin", admin:"/admin", customer:"/customer" }[role] || "/login");
