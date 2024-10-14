
// Function to send Telegram message
async function sendTelegramMessage(userId, message, bot) {
    try {
        const sentMessage = await bot.sendMessage(userId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        });
        return sentMessage.message_id; // Return message ID for further tracking
    } catch (error) {
        console.error(`Error sending Telegram message: ${error.message}`);
        return null;
    }
}

// Function to update Telegram message
async function updateTelegramMessage(userId, messageId, newMessage, bot) {
    try {
        await bot.editMessageText(newMessage, {
            chat_id: userId,
            message_id: messageId,
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        });
    } catch (error) {
        console.error(`Error updating Telegram message: ${error.message}`);
    }
}


module.exports = {
    sendTelegramMessage,
    updateTelegramMessage,
};