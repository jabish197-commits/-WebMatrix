export const validateUser=(body)=>!body.name||!body.email?["Name and email are required"]:[];
