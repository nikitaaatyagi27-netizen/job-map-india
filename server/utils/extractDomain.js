

const { URL } = require("url");
const { detectATSProvider } = require("./atsProviderRegistry");

function cleanDomain(host){

if(!host) return null;

return host
.replace("www.","")
.toLowerCase();

}

function extractFromUrl(url){

if(!url) return null;

try{

const parsed =
new URL(url);

return cleanDomain(
parsed.hostname
);

}catch{

return null;

}

}

function extractATS(url){

if(!url) return null;

const detected =
detectATSProvider(url);

if(!detected)
return null;

if(detected.companySlug)
return `${detected.companySlug}.com`;

return null;

}

function guessDomain(name){

if(!name) return null;

const base =
name
.toLowerCase()
.replace(/[^a-z0-9]/g,"");

if(base.length < 4)
return null;

return base+".com";

}

function extractDomain(job){

// 1 BEST → official website
if(job.employer_website){

const domain =
extractFromUrl(
job.employer_website
);

if(domain)
return domain;

}


// 2 Apply link
if(job.job_apply_link){

const ats =
extractATS(
job.job_apply_link
);

if(ats)
return ats;

const direct =
extractFromUrl(
job.job_apply_link
);

if(direct)
return direct;

}


// 3 fallback guess
return guessDomain(
job.employer_name
);

}

module.exports =
extractDomain;