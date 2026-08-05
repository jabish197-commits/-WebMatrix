import api from "./axiosInstance"; export const getUsers = () => api("/users"); export const createAdmin = (data) => api("/admins", { method:"POST", body:JSON.stringify(data) });
