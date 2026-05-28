require("dotenv").config();

const connectDB =
require("../config/db");

const Company =
require("../models/Company");

connectDB();

async function enrich(){

const companies =
await Company.find({});

console.log(
"Companies to process:",
companies.length
);

let updated = 0;

for(const company of companies){

if(company.domain)
continue;

const domain =
company.name
.toLowerCase()
.replace(/[^a-z0-9]/g,"") + ".com";

company.domain =
domain;

await company.save();

updated++;

console.log(
"Updated:",
company.name,
domain
);

}

console.log(
"Total updated:",
updated
);

console.log("Done");

process.exit();

}

enrich();