require("dotenv").config();

const connectDB =
require("../config/db");

const Company =
require("../models/Company");

connectDB();

async function fix(){

const companies =
await Company.find({});

let fixed = 0;

for(const company of companies){

if(
company.logo &&
company.logo.includes("logo.dev")
){

company.logo = null;

await company.save();

fixed++;

console.log(
"Removed broken logo:",
company.name
);

}

}

console.log(
"Total fixed:",
fixed
);

process.exit();

}

fix();