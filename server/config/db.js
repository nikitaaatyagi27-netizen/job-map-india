const mongoose = require("mongoose");

const connectDB = async () => {

try{

const conn = await mongoose.connect(process.env.MONGO_URI);

console.log("✅ Mongo Connected");

}catch(error){

console.log("❌ Mongo connection failed");

console.log(error.message);

process.exit(1);

}

};

module.exports = connectDB;