
// Function to send Telegram message
async function sendTelegramMessage(userId, message, bot) {
    try {
        const sentMessage = await bot.sendMessage(userId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        });
        console.log(`Sent message to user ${userId}: ${sentMessage.message_id}`);
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

// Function to delete Telegram message
async function deleteTelegramMessage(userId, messageId, bot) {
    console.log(`Deleting message ${messageId} for user ${userId}`);
    try {
        await bot.deleteMessage(userId, messageId);
    } catch (error) {
        console.error(`Error deleting Telegram message: ${error.message}`);
    }
}


module.exports = {
    sendTelegramMessage,
    updateTelegramMessage,
    deleteTelegramMessage
};