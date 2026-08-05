export const uploadImage=async(file)=>({url:file?.path || "",publicId:file?.filename || ""});
