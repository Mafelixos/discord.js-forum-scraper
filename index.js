const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

// Bot configuration found in .env file
const CONFIG = {
    TOKEN: process.env.TOKEN,
    GUILD_ID: process.env.GUILD_ID,
    FORUM_CHANNEL_ID: process.env.FORUM_CHANNEL_ID, 
    LOG_FILE: process.env.LOG_FILE,
};

// Create Discord client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Storage for logged user IDs
let loggedAuthors = new Set();

// Load existing data on startup
async function loadExistingData() {
    try {
        const data = await fs.readFile(CONFIG.LOG_FILE, 'utf8');
        const parsed = JSON.parse(data);
        loggedAuthors = new Set(parsed.authors || []);
        console.log(`Loaded ${loggedAuthors.size} existing authors from log file`);
    } catch (error) {
        console.log('No existing log file found, starting fresh');
    }
}

// Save data to file
async function saveData() {
    const data = {
        authors: Array.from(loggedAuthors),
        lastUpdated: new Date().toISOString(),
        totalCount: loggedAuthors.size
    };
    
    try {
        await fs.writeFile(CONFIG.LOG_FILE, JSON.stringify(data, null, 2));
        console.log(`Saved ${loggedAuthors.size} authors to ${CONFIG.LOG_FILE}`);
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Log a new post author
async function logPostAuthor(userId, username, threadName) {
    if (!loggedAuthors.has(userId)) {
        loggedAuthors.add(userId);
        console.log(`New post author logged: ${username} (${userId}) in thread: "${threadName}"`);
        await saveData();
    }
}

// Scan existing forum posts on startup
async function scanExistingPosts() {
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        if (!guild) {
            console.error('Guild not found!');
            return;
        }

        const forumChannel = guild.channels.cache.get(CONFIG.FORUM_CHANNEL_ID);
        if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
            console.error('Forum channel not found or is not a forum channel!');
            return;
        }

        console.log(`Scanning existing posts in forum: ${forumChannel.name}`);
        
        // Get all active threads (posts) in the forum
        const threads = await forumChannel.threads.fetchActive();
        const archivedThreads = await forumChannel.threads.fetchArchived({ fetchAll: true });
        
        const allThreads = new Map([...threads.threads, ...archivedThreads.threads]);
        
        console.log(`Found ${allThreads.size} total threads to scan`);
        
        for (const [threadId, thread] of allThreads) {
            try {
                // Get the starter message (original post)
                const starterMessage = await thread.fetchStarterMessage();
                if (starterMessage && starterMessage.author) {
                    await logPostAuthor(
                        starterMessage.author.id, 
                        starterMessage.author.username,
                        thread.name
                    );
                }
            } catch (error) {
                console.error(`Error processing thread ${thread.name}:`, error.message);
            }
        }
        
        console.log(`Scan complete! Total unique authors: ${loggedAuthors.size}`);
        
    } catch (error) {
        console.error('Error scanning existing posts:', error);
    }
}

// Bot ready event
client.once(Events.ClientReady, async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    
    // Load existing data
    await loadExistingData();
    
    // Scan existing posts
    await scanExistingPosts();
    
    console.log('Bot is ready and monitoring for new posts!');
});

// Monitor for new forum posts
client.on(Events.ThreadCreate, async (thread) => {
    // Check if this is in our target forum channel
    if (thread.parentId === CONFIG.FORUM_CHANNEL_ID) {
        try {
            // Get the starter message (original post)
            const starterMessage = await thread.fetchStarterMessage();
            if (starterMessage && starterMessage.author) {
                await logPostAuthor(
                    starterMessage.author.id,
                    starterMessage.author.username,
                    thread.name
                );
                console.log(`New forum post detected: "${thread.name}" by ${starterMessage.author.username}`);
            }
        } catch (error) {
            console.error('Error processing new thread:', error);
        }
    }
});

// Error handling
client.on('error', console.error);

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down bot...');
    await saveData();
    client.destroy();
    process.exit(0);
});

// Login to Discord
client.login(CONFIG.TOKEN);