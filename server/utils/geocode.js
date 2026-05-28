const axios = require("axios");

const getCoords = async (location) => {

try{

if(!location) return null;

const response = await axios.get(

"https://maps.googleapis.com/maps/api/geocode/json",

{

params:{
address:location,
key:process.env.GOOGLE_MAPS_API_KEY
}

}

);

if(response.data.results.length > 0){

return{

lat:response.data
.results[0]
.geometry.location.lat,

lng:response.data
.results[0]
.geometry.location.lng

};

}

}catch(error){

console.log("Geocode failed");

}

return null;

};

module.exports = getCoords;