const axios = require('axios');

async function checkGasFee() {
    try {
        const response = await axios.get('https://mempool.space/api/v1/fees/recommended');
        const fastestFee = response.data.fastestFee;
        const halfHourFee = response.data.halfHourFee;
        const hourFee = response.data.hourFee;
        console.log(`Current Gas Fee:, Fast - ${fastestFee} | Average - ${halfHourFee} | Low - ${hourFee}`);
        return Array(fastestFee, halfHourFee, hourFee);
    } catch (error) {
        console.log('API error:', error.message);
    }
}

module.exports = {
    checkGasFee
};