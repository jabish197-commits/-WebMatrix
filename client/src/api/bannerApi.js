import api from "./axiosInstance"; export const getBanners = () => api("/banners"); export const createBanner = (data) => api("/banners", { method:"POST", body:JSON.stringify(data) });
