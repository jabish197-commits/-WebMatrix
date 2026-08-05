export const dashboard=async(req,res)=>res.json({role:req.user.role,message:`Welcome to the ${req.user.role} dashboard`});
