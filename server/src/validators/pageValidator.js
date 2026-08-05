export const validatePage=(body)=>!body.slug||!body.title?["Slug and title are required"]:[];
