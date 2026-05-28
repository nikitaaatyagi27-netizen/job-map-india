require("dotenv").config();

const connectDB =
require("../config/db");

const Company =
require("../models/Company");
const { resolveBranding } =
require("../utils/brandingResolver");

async function enrich(){

const companies =
await Company.find({});

console.log(
"Companies found:",
companies.length
);

let updated = 0;

for(const company of companies){

// Skip if valid logo already exists
if(
company.logo &&
!company.logo.includes("logo.dev") &&
!company.logo.includes("google.com/s2/favicons")
){
continue;
}

const branding =
resolveBranding(company);

if(!branding.logo)
continue;
	
	
// Save
company.logo = branding.logo;
company.brandingSource =
branding.brandingSource;
company.brandingConfidence =
branding.brandingConfidence;

await company.save();

updated++;

console.log(
"Logo enriched:",
company.name
);

}

console.log(
"Total updated:",
updated
);

process.exit();

}

async function run() {
	await connectDB();
	await enrich();
}

run().catch((error) => {
	console.error("[ENRICH LOGOS] Failed");
	console.error(error.message);
	process.exit(1);
});
