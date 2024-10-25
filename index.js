require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const cron = require('node-cron');
const { trackTransactions } = require('./api/transaction');
const { getRuneBalance, getBrc20Balance } = require('./api/unisat');
const { sendTelegramMessage, updateTelegramMessage } = require('./api/telegram');
const { checkGasFee } = require('./api/gas');


let users = {}; // In-memory storage for users and addresses
const userStates = {}; // To store both state and timeout for each user


// Initialize Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: true
});


// Load existing users from a file if needed
if (fs.existsSync('users.json')) {
    try {
        users = JSON.parse(fs.readFileSync('users.json'));
    } catch (error) {
        console.error('Error reading users.json:', error.message);
        users = {};
    }
}


// Save users to a file
function saveUsers() {
    try {
        fs.writeFileSync('users.json', JSON.stringify(users));
    } catch (error) {
        console.error('Error saving users to file:', error.message);
    }
}


// Updated Bitcoin address validation function
function isValidBitcoinAddress(address) {
    // Check if the address starts with "bc" and has a length between 42 and 62 characters
    const taprootAddressRegex = /^bc[a-z0-9]{40,60}$/;
    return taprootAddressRegex.test(address);
}


// Utility to set and clear timeouts for user states
function setUserState(userId, state, duration, timeoutMessage) {
    // Clear existing timeout if it exists
    if (userStates[userId]?.timeout) {
        clearTimeout(userStates[userId].timeout);
    }

    // Set the new state and timeout
    userStates[userId] = {
        state,
        timeout: setTimeout(() => {
            if (userStates[userId]?.state === state) {
                sendTelegramMessage(userId, timeoutMessage, bot);
                delete userStates[userId]; // Clear user state after timeout
            }
        }, duration)
    };
}


// Address registration 
bot.onText(/\/register/, (msg) => {
    const userId = msg.chat.id;

    // Check if the user is already registered
    if (users[userId]) {
        return sendTelegramMessage(userId, '⚠️ You have already registered your wallet!', bot);
    }
    sendTelegramMessage(userId, '💳 Please send your Bitcoin wallet address (Timeout in 2 minutes):', bot);

    setUserState(userId, 'awaiting_address', 120000, '⌛ Timeout: You didn’t provide your Bitcoin address in time. Please try again.');
});


// setting gas price thrreshold for the user (to recive gas alerts when gas price drop below the threshold) 
bot.onText(/\/set_gas/, (msg) => {
    const userId = msg.chat.id;

    // Check if the user is registered
    if (!users[userId]) {
        return sendTelegramMessage(userId, '⚠️ You have not registered your wallet yet!', bot);
    }
    sendTelegramMessage(userId, '🖊 Please send your preferred gas price threshold (Timeout in 2 minutes):', bot);

    setUserState(userId, 'awaiting_threshold', 120000, '⌛ Timeout: You didn’t provide a gas price threshold in time. Please try again layer.');
});


// remove gas price thrreshold for the user 
bot.onText(/\/remove_gas/, (msg) => {
    const userId = msg.chat.id;

    // Check if the user has set a gas threshold
    if (!users[userId].gasThreshold) {
        return sendTelegramMessage(userId, '⚠️ You have not set a gas price threshold yet.', bot);
    }
    delete users[userId].gasThreshold;
    saveUsers();

    sendTelegramMessage(userId, '🗑 Your gas price threshold has been removed. You will no longer receive gas alerts!', bot);
});


// Global listener for capturing messages, including after /register
bot.on('message', (msg) => {
    const userId = msg.chat.id;
    const text = msg.text;

    // Check if the user is in the 'awaiting_address' state
    if (userStates[userId]?.state === 'awaiting_address') {
        if (!isValidBitcoinAddress(text)) {
            return sendTelegramMessage(userId, '⚠️ Invalid Bitcoin address. Please send again.', bot);
        }

        // Clear the user's state and timeout after successful registration
        clearTimeout(userStates[userId].timeout);
        delete userStates[userId];

        // Register the user with the provided address
        const address = text;
        const currentTimestampInSeconds = Math.floor(Date.now() / 1000);

        users[userId] = {
            address,
            lastBlockTime: currentTimestampInSeconds,
            pendingTxMessages: {} // Each user has their own pending transactions
        };
        saveUsers();

        // Confirm registration and clear the user's state and timeout
        const message = `💳 Your Bitcoin wallet ${address} has been registered!\n\nYou will now receive transaction alerts.`;
        sendTelegramMessage(userId, message, bot);
    }

    // Check if the user is in the 'awaiting_edit' state
    else if (userStates[userId]?.state === 'awaiting_edit') {
        // Validate the new Bitcoin address
        if (!isValidBitcoinAddress(text)) {
            return sendTelegramMessage(userId, '⚠️ Invalid Bitcoin address. Please send a valid address.', bot);
        }

        // Clear user state and timeout after successful edit
        clearTimeout(userStates[userId].timeout);
        delete userStates[userId];

        // Update the user's address with the new one
        users[userId].address = text;
        saveUsers();

        // Confirm the update
        const message = `💳 Your Bitcoin wallet address has been updated to: ${text}`;
        sendTelegramMessage(userId, message, bot);
    }

    // Check if the user is in the 'awaiting_threshold' state
    else if (userStates[userId]?.state === 'awaiting_threshold') {
        // Validate the gas price threshold
        if (!/^\-?\d+$/.test(text)) {
            return sendTelegramMessage(userId, '⚠️ Invalid gas price threshold (must be an integer). Please send again.', bot);
        }
        const parsedValue = parseInt(text, 10);

        // Clear the user's state and timeout after successful registration
        clearTimeout(userStates[userId].timeout);
        delete userStates[userId];

        users[userId].gasThreshold = parsedValue;
        saveUsers();

        const message = `⛽️ Your gas price threshold has been set to: ${parsedValue} sat/vB`;
        sendTelegramMessage(userId, message, bot);
    }
});


// Command to check the balance of RUNE tokens
bot.onText(/\/rune/, async (msg) => {
    const userId = msg.chat.id;

    // Check if user has already registered with an address
    if (!users[userId] || !users[userId].address) {
        sendTelegramMessage(userId, '⚠️ You have not registered a Bitcoin address yet. Please use /register to register.', bot);
        return;
    }

    const address = users[userId].address;

    try {
        // Get the rune balance for the user's address
        const runeBalances = await getRuneBalance(address);

        if (runeBalances.length === 0) {
            sendTelegramMessage(userId, `No runes found for your Bitcoin address ${address}.`, bot);
            return;
        }

        let message = `🔮 *Rune Balances*\n\n`;
        runeBalances.forEach(rune => {
            const balance = Number(rune.amount);
            const formattedAmount = balance.toLocaleString();
            message += `${rune.symbol} [${rune.name}](https://unisat.io/runes/market?tick=${encodeURIComponent(rune.name)}): ${formattedAmount}\n`;
        });

        sendTelegramMessage(userId, message, bot);
    } catch (error) {
        console.error('Error fetching rune balance:', error);
        sendTelegramMessage(userId, '⚠️ Failed to fetch rune balances. Please try again later.', bot);
    }
});


// Command to check the balance of BRC20 tokens
bot.onText(/\/brc20/, async (msg) => {
    const userId = msg.chat.id;

    // Check if user has already registered with an address
    if (!users[userId] || !users[userId].address) {
        sendTelegramMessage(userId, '⚠️ You have not registered a Bitcoin address yet. Please use /register to register.', bot);
        return;
    }

    const address = users[userId].address;

    try {
        // Get the BRC20 balance for the user's address
        const brc20Balances = await getBrc20Balance(address);

        if (brc20Balances.length === 0) {
            sendTelegramMessage(userId, `No BRC20 tokens found for your Bitcoin address ${address}.`, bot);
            return;
        }

        let message = `💰 *BRC20 Balances*\n\n`;
        brc20Balances.forEach(token => {
            const balance = Number(token.balance);
            const formattedAmount = balance.toLocaleString();
            message += `[${token.ticker}](https://unisat.io/market/brc20?tick=${token.ticker}): ${formattedAmount}\n`;
        });

        sendTelegramMessage(userId, message, bot);
    } catch (error) {
        console.error('Error fetching BRC20 balance:', error);
        sendTelegramMessage(userId, '⚠️ Failed to fetch BRC20 token balances. Please try again later.', bot);
    }
});


// Check Ordinals balance
bot.onText(/\/ordinals/, (msg) => {
    const userId = msg.chat.id;
    const message = '🛠️ The Ordinals feature is coming soon! Stay tuned!';
    sendTelegramMessage(userId, message, bot);
});


// Display the registered Bitcoin address
bot.onText(/\/user/, (msg) => {
    const userId = msg.chat.id;

    // Check if user has registered an address
    if (users[userId] && users[userId].address) {
        const address = users[userId].address;
        sendTelegramMessage(userId, `💳 Your registered Bitcoin address is: ${address}`, bot);
    } else {
        sendTelegramMessage(userId, '⚠️ You have not registered a Bitcoin address yet. Use /register to register.', bot);
    }
});


// Unregister the user and remove their Bitcoin address
bot.onText(/\/unregister/, (msg) => {
    const userId = msg.chat.id;

    // Check if the user has registered an address
    if (users[userId]) {
        delete users[userId];
        saveUsers();
        sendTelegramMessage(userId, '🗑️ Your Bitcoin wallet address has been unregistered.', bot);
    } else {
        sendTelegramMessage(userId, '⚠️ You are not registered. Use /register to register your address.', bot);
    }
});


// Handle the /start command
bot.onText(/\/start/, (msg) => {
    const userId = msg.chat.id;
    const startMessage = `Welcome to the Bitcoin Transaction Tracker Bot! \n\n` +
                         `Use the command /register to start receiving transaction alerts.\n`;
    sendTelegramMessage(userId, startMessage, bot);
});


// Edit the registered Bitcoin address
bot.onText(/\/edit/, (msg) => {
    const userId = msg.chat.id;

    // Check if the user is registered
    if (!users[userId]) {
        return sendTelegramMessage(userId, '⚠️ You have not registered a Bitcoin address yet. Use /register to register.', bot);
    }

    sendTelegramMessage(userId, '✏️ Please send your new Bitcoin wallet address (Timeout in 2 minutes):', bot);

    // Set the state to 'awaiting_edit' for the user
    if (userStates[userId]?.timeout) {
        clearTimeout(userStates[userId].timeout);
    }
    userStates[userId] = {
        state: 'awaiting_edit',
        timeout: setTimeout(() => {
            if (userStates[userId]?.state === 'awaiting_edit') {
                sendTelegramMessage(userId, '⌛ Timeout: You didn’t provide the new address in time. Please try again later.', bot);
                delete userStates[userId];
            }
        }, 120000) // 2 minutes
    };
});


// Get the current gas price of the Bitcoin network
bot.onText(/\/gas/, async (msg) => {
    const userId = msg.chat.id;

    const gasFees = await checkGasFee();

    const startMessage = `🚀 Fast :  ${gasFees[0]} sat/vB\n` +
                         `🚗 Average :  ${gasFees[1]} sat/vB\n` +
                         `🐢 Slow :  ${gasFees[2]} sat/vB\n`;
    sendTelegramMessage(userId, startMessage, bot);
});


// Display the list of available commands
bot.onText(/\/help/, (msg) => {
    const userId = msg.chat.id;
    const helpMessage = `📜 *Available Commands*\n\n` +
                        `/register - Register your Bitcoin wallet address\n` +
                        `/user - View your registered Bitcoin address\n` +
                        `/unregister - Remove your registered Bitcoin address\n` +
                        `/edit - Edit your registered Bitcoin address\n` +
                        `/gas - Check the current gas price\n` +
                        `/set_gas - Set a gas price threshold for alerts\n` +
                        `/remove_gas - Remove your gas price threshold\n` +
                        `/rune - Check your Rune balances\n` +
                        `/brc20 - Check your BRC20 token balances\n` +
                        `/ordinals - Check Ordinals (Coming Soon)`;       
    sendTelegramMessage(userId, helpMessage, bot);
});


// Schedule the job to run every 2 minutes
cron.schedule('*/1 * * * *', async () => {
    for (const userId in users) {
        const { address, lastBlockTime, pendingTxMessages } = users[userId];

        try {
            const updatedLastBlockTime = await trackTransactions(userId, address, lastBlockTime, pendingTxMessages, bot);

            if (updatedLastBlockTime !== lastBlockTime) {
                users[userId].lastBlockTime = updatedLastBlockTime;
                saveUsers();
            }
        } catch (error) {
            console.error(`Error tracking transactions for user ${userId}:`, error.message);
            bot.sendMessage(userId, `An error occurred while tracking your transactions. We are working to resolve this issue.`);
        }
    }
});

// Schedule gas fee check every 4 minutes
cron.schedule('*/5 * * * *', async () => {
    try {
        // Fetch the current gas fees
        const gasFees = await checkGasFee();
        const gasPrice = gasFees[1]; // Using the average gas price

        for (const userId in users) {
            const { gasThreshold } = users[userId];

            if (gasThreshold && gasPrice <= gasThreshold) {
                const message = `⛽️ *Gas Price Alert!* *${gasPrice}* sat/vB`;
                sendTelegramMessage(userId, message, bot);
            }
        }
    } catch (error) {
        console.error('Error in gas fee check:', error.message);
    }
});
