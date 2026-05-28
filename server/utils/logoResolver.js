const { resolveBranding } = require("./brandingResolver");

function resolveLogo(company){
return resolveBranding(company).logo;
}

module.exports =
resolveLogo;
