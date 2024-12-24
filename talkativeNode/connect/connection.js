// db.js
const mongoose = require('mongoose');

/**
 * Connect to MongoDB Atlas
 * @param {string} uri - MongoDB connection URI
 * @returns {Promise} - Resolves when connected to the database
 */

const connection = async (uri) => {
  try {
    const options = {
      dbName: 'talkwithgirls'
    };

    await mongoose.connect(uri, options);
    console.log('MongoDB Atlas connected successfully!');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1); // Exit the process with failure code
  }
};

module.exports = connection;