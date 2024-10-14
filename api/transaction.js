const axios = require('axios');
const { 
    sendTelegramMessage, 
    updateTelegramMessage 
} = require('./telegram');


// Function to fetch transactions for the given address
async function fetchTransactions(address) {
    try {
        const response = await axios.get(`https://mempool.space/api/address/${address}/txs`);

        // Axios automatically parses the JSON response, so you can access the data directly
        return response.data;
    } catch (error) {
        console.error(`Error fetching transactions: ${error.message}`);
        return [];
    }
}

// Function to get the current price of BTC in USD
async function getBtcPriceInUsd() {
    try {
        const response = await axios.get("https://mempool.space/api/v1/prices");
        return response.data.USD; // Return the value of BTC in USD
    } catch (error) {
        console.error(`Error fetching BTC price: ${error.message}`);
        return null; // Return null in case of an error
    }
}

// Function to calculate total vin and vout for given address
function calculateVinVout(transaction, address) {
    try {
        let totalVin = 0;
        let totalVout = 0;
    
        // Calculate total vin
        transaction.vin.forEach(input => {
        if (input.prevout.scriptpubkey_address === address) {
            totalVin += input.prevout.value; // Add the value of the matching vin
        }
        });
    
        // Calculate total vout
        transaction.vout.forEach(output => {
        if (output.scriptpubkey_address === address) {
            totalVout += output.value; // Add the value of the matching vout
        }
        });
    
        return { totalVin, totalVout };
    } catch (error) {
        console.error(`Error calculating input & output: ${error.message}`);
        return { totalVin: 0, totalVout: 0 };
    }
}

// Function to check for new transactions
async function trackTransactions(userId, address, lastBlockTime, pendingTxMessages, bot) {
    try {
        const bitcoinAddress = address;
        const transactions = await fetchTransactions(bitcoinAddress);

        if (!Array.isArray(transactions)) {
            throw new Error('Transactions response is not an array');
        }

        // Sort transactions based on block time in ascending order
        transactions.sort((a, b) => a.status.block_time - b.status.block_time);

        const btcPrice = await getBtcPriceInUsd();

        for (const tx of transactions) {
            const blockTime = tx.status.block_time;
            const isConfirmed = tx.status.confirmed;
            const txId = tx.txid;

            // Check if the transaction is new based on block time

            if ((isConfirmed && blockTime >= lastBlockTime && !pendingTxMessages[txId]) || (!isConfirmed && !pendingTxMessages[txId])) {
                const isOutgoing = tx.vin.some(input => input.prevout.scriptpubkey_address === bitcoinAddress);

                // Calculate the transaction value
                let amount = 0;
                const result = calculateVinVout(tx, bitcoinAddress);

                if (isOutgoing) {
                    amount = result.totalVin - result.totalVout;
                } else {
                    amount = result.totalVout;
                }

                amount = amount / 100000000; // Convert from satoshis to BTC
                const valueInUSD = amount * btcPrice;

                console.log(`[${userId}] New transaction: ${txId}, ${isOutgoing ? 'Outgoing' : 'Incoming'}, ${isConfirmed ? 'Confirmed' : 'Pending'}, ${amount.toFixed(8)} BTC, $${valueInUSD.toFixed(2)}`);

                const initialMessage = `${isOutgoing ? '📤 *Outgoing*' : '📥 *Incoming*'} *Transaction Detected*!\n` +
                    `Bitcoin Address: [${bitcoinAddress}](https://mempool.space/address/${bitcoinAddress})\n` +
                    `${isOutgoing ? 'Sent' : 'Received'}: ${amount.toFixed(8)} BTC ($${valueInUSD.toFixed(2)})\n` +
                    `[Tx hash](https://mempool.space/tx/${tx.txid})\n` +
                    `Status: ${isConfirmed ? '✅ *Confirmed*' : '⏳ *Pending*'}`;

                const messageId = await sendTelegramMessage(userId, initialMessage, bot);

                if (messageId && !isConfirmed) {
                    pendingTxMessages[txId] = {
                        messageId: messageId,
                        messageContent: initialMessage
                    };
                }

                // Update lastBlockTime only if tx is confirmed
                if (isConfirmed) {
                    lastBlockTime = blockTime;
                }
            }

            // If the transaction was previously pending and is now confirmed, update the message
            if (isConfirmed && pendingTxMessages[txId]) {
                // Get the previous message content
                const previousMessageContent = pendingTxMessages[txId].messageContent;
                const confirmedMessage = previousMessageContent.replace('⏳ *Pending*', '✅ *Confirmed*');

                console.log(`[${userId}] Transaction confirmed: ${txId}, updating message...`);

                await updateTelegramMessage(userId, pendingTxMessages[txId].messageId, confirmedMessage, bot);

                // Remove the transaction from pending list since it's confirmed
                delete pendingTxMessages[txId];

                // Update lastBlockTime
                lastBlockTime = blockTime;
            }
        }

        lastBlockTime = lastBlockTime+1; // Increment lastBlockTime by 1 to avoid duplicate messages
        console.log(`[${userId}] Transactions processed successfully!. Next check in 60 seconds.`);
        return lastBlockTime;

    } catch (error) {
        console.error(`Error processing transactions: ${error.message}`);
    }
}

module.exports = {
    trackTransactions,
};