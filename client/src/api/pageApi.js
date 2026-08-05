import api from "./axiosInstance"; export const getPage = (slug) => api(`/pages/${slug}`); export const updatePage = (id, data) => api(`/pages/${id}`, { method:"PATCH", body:JSON.stringify(data) });
