require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const { trackTransactions } = require('./api/transaction');
const { getRuneBalance, getBrc20Balance } = require('./api/unisat');
const { sendTelegramMessage, updateTelegramMessage } = require('./api/telegram');


const userStates = {}; // To store both state and timeout for each user


// Initialize Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: true
});

let users = {}; // In-memory storage for users and addresses

// Load existing users from a file if needed
if (fs.existsSync('users.json')) {
    try {
        users = JSON.parse(fs.readFileSync('users.json'));
    } catch (error) {
        console.error('Error reading users.json:', error.message);
        users = {}; // Fallback to an empty object on error
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



// Command to start the registration process
bot.onText(/\/register/, (msg) => {
    const userId = msg.chat.id;

    // Check if the user is already registered
    if (users[userId]) {
        return sendTelegramMessage(userId, '⚠️ You have already registered your wallet!', bot);
    }

    // Ask the user for their Bitcoin address
    sendTelegramMessage(userId, '💳 Please send me your Bitcoin wallet address (Timeout in 2 minutes):', bot);

    // Set the user state to 'awaiting_address' and store a timeout
    if (userStates[userId]?.timeout) {
        clearTimeout(userStates[userId].timeout); // Clear any previous timeouts
    }

    userStates[userId] = {
        state: 'awaiting_address',
        timeout: setTimeout(() => {
            if (userStates[userId]?.state === 'awaiting_address') {
                sendTelegramMessage(userId, '⌛ Timeout: You didn’t provide your Bitcoin address in time. Please try again layer.', bot);
                delete userStates[userId]; // Clear user state after timeout
            }
        }, 120000) // Timeout set to 60 seconds (1 minute)
    };
});


// Global listener for capturing messages, including after /register
bot.on('message', (msg) => {
    const userId = msg.chat.id;
    const text = msg.text;

    // Check if the user is in the 'awaiting_address' state
    if (userStates[userId]?.state === 'awaiting_address') {
        // Validate the Bitcoin address
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

        // Construct the message with each rune's ticker, name, and balance
        let message = `🔮 *Rune Balances*\n\n`;
        runeBalances.forEach(rune => {
            const balance = Number(rune.amount);
            const formattedAmount = balance.toLocaleString();
            message += `${rune.symbol} [${rune.name}](https://unisat.io/runes/market?tick=${encodeURIComponent(rune.name)}): ${formattedAmount}\n`;
        });

        sendTelegramMessage(userId, message, bot);
    } catch (error) {
        // Handle error (e.g., API error or network issue)
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

        // Construct the message with each token's ticker and overall balance
        let message = `💰 *BRC20 Balances*\n\n`;
        brc20Balances.forEach(token => {
            const balance = Number(token.balance);  // Using overallBalance from the BRC20 data
            const formattedAmount = balance.toLocaleString();
            message += `[${token.ticker}](https://unisat.io/market/brc20?tick=${token.ticker}): ${formattedAmount}\n`;
        });

        sendTelegramMessage(userId, message, bot);
    } catch (error) {
        // Handle error (e.g., API error or network issue)
        console.error('Error fetching BRC20 balance:', error);
        sendTelegramMessage(userId, '⚠️ Failed to fetch BRC20 token balances. Please try again later.', bot);
    }
});


// Command to check Ordinals balance
bot.onText(/\/ordinals/, (msg) => {
    const userId = msg.chat.id;
    const message = '🛠️ The Ordinals feature is coming soon! Stay tuned!';
    sendTelegramMessage(userId, message, bot);
});


// Command to display the registered Bitcoin address
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


// Command to unregister the user and remove their Bitcoin address
bot.onText(/\/unregister/, (msg) => {
    const userId = msg.chat.id;

    // Check if the user has registered an address
    if (users[userId]) {
        delete users[userId]; // Remove user from the users object
        saveUsers();
        sendTelegramMessage(userId, '🗑️ Your Bitcoin wallet address has been unregistered.', bot);
    } else {
        sendTelegramMessage(userId, '⚠️ You are not registered. Use /register to register your address.', bot);
    }
});


// Command to handle the /start command
bot.onText(/\/start/, (msg) => {
    const userId = msg.chat.id;
    const startMessage = `Welcome to the Bitcoin Transaction Tracker Bot! \n\n` +
                         `Use the command /register to start receiving transaction alerts.\n`;
    const messageId = sendTelegramMessage(userId, startMessage, bot);
});


// Command to start editing the registered Bitcoin address
bot.onText(/\/edit/, (msg) => {
    const userId = msg.chat.id;

    // Check if the user is registered
    if (!users[userId]) {
        return sendTelegramMessage(userId, '⚠️ You have not registered a Bitcoin address yet. Use /register to register.', bot);
    }

    // Ask for the new Bitcoin address
    sendTelegramMessage(userId, '✏️ Please send your new Bitcoin wallet address (Timeout in 2 minutes):', bot);

    // Set the state to 'awaiting_edit' for the user
    if (userStates[userId]?.timeout) {
        clearTimeout(userStates[userId].timeout); // Clear any previous timeouts
    }

    userStates[userId] = {
        state: 'awaiting_edit',
        timeout: setTimeout(() => {
            if (userStates[userId]?.state === 'awaiting_edit') {
                sendTelegramMessage(userId, '⌛ Timeout: You didn’t provide the new address in time. Please try again later.', bot);
                delete userStates[userId]; // Clear the user state after timeout
            }
        }, 120000) // Timeout set to 2 minutes
    };
});


// Global listener for the /edit command to capture the new address
bot.on('message', (msg) => {
    const userId = msg.chat.id;
    const text = msg.text;

    // Check if the user is in the 'awaiting_edit' state
    if (userStates[userId]?.state === 'awaiting_edit') {
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
});


// Command to display the list of available commands
bot.onText(/\/help/, (msg) => {
    const userId = msg.chat.id;
    const helpMessage = `
    📜 *Available Commands*:

    /register - Register your Bitcoin wallet address
    /user - View your registered Bitcoin address
    /unregister - Remove your registered Bitcoin address
    /edit - Edit your registered Bitcoin address
    /rune - Check your Rune balances
    /brc20 - Check your BRC20 token balances
    /ordinals - Check Ordinals (Coming Soon)
    `;
    sendTelegramMessage(userId, helpMessage, bot);
});


// Periodically track transactions for all users
setInterval(async () => {
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
            // Optionally send a message to the user about the error
            bot.sendMessage(userId, `An error occurred while tracking your transactions: ${error.message}`);
        }
    }
}, 60000);
