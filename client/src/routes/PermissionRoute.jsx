export default function PermissionRoute({ user, permission, children }) { return user?.role === "super_admin" || user?.permissions?.includes(permission) ? children : null; }
