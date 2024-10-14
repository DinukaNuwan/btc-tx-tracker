require('dotenv').config();
const axios = require('axios');

async function getRuneBalance(address) {
    try {
        const response = await axios.get(`https://open-api.unisat.io/v1/indexer/address/${address}/runes/balance-list`, {
            headers: {
                'Authorization': `Bearer ${process.env.UNISAT_API_KEY}`
            },
            params: {
                start: 1,
                limit: 500
            }
        });

        if (response.data.code !== 0) {
            throw new Error(`API responded with an error: Code ${response.data.code}`);
        }

        const runeList = response.data.data.detail.map(rune => ({
            name: rune.spacedRune,
            symbol: rune.symbol,
            amount: rune.amount
        }));

        return runeList;

    } catch (error) {
        if (error.response) {
            console.error('Error response from API:', error.response.data);
            throw new Error(`API error: ${error.response.data.message || 'Unknown error'}`);
        } else if (error.request) {
            console.error('No response received from API:', error.request);
            throw new Error('No response from API. Please check your network or API key.');
        } else {
            console.error('Error occurred:', error.message);
            throw new Error(`Request failed: ${error.message}`);
        }
    }
}


async function getBrc20Balance(address) {
    try {
        const response = await axios.get(`https://open-api.unisat.io/v1/indexer/address/${address}/brc20/summary`, {
            headers: {
                'Authorization': `Bearer ${process.env.UNISAT_API_KEY}`
            },
            params: {
                start: 1,
                limit: 500,
                tick_filter: 24
            }
        });

        if (response.data.code !== 0) {
            throw new Error(`API responded with an error: Code ${response.data.code}`);
        }

        const brc20List = response.data.data.detail
            .filter(asset => parseFloat(asset.overallBalance) > 0)
            .map(asset => ({
                ticker: asset.ticker,
                balance: asset.overallBalance
            }));

        return brc20List;

    } catch (error) {
        if (error.response) {
            console.error('Error response from API:', error.response.data);
            throw new Error(`API error: ${error.response.data.message || 'Unknown error'}`);
        } else if (error.request) {
            console.error('No response received from API:', error.request);
            throw new Error('No response from API. Please check your network or API key.');
        } else {
            console.error('Error occurred:', error.message);
            throw new Error(`Request failed: ${error.message}`);
        }
    }
}


module.exports = {
    getRuneBalance,
    getBrc20Balance,
};