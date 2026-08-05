export default function usePermission(user) { return (permission) => user?.role === "super_admin" || user?.permissions?.includes(permission); }
