export const sendEmail=async({to,subject})=>{ console.log(`Email queued for ${to}: ${subject}`); return {accepted:[to]}; };
