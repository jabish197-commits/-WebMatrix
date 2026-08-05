export default function validateRequest(validator){return(req,res,next)=>{const errors=validator(req.body);return errors.length?res.status(400).json({message:"Validation failed",errors}):next();};}
