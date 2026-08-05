export const validateSettings=(body)=>body.platformName!==undefined&&!body.platformName.trim()?["Platform name cannot be empty"]:[];
