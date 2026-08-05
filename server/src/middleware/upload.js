export const uploadSingle=(req,_res,next)=>{req.file=req.file||null;next();}; export default uploadSingle;
