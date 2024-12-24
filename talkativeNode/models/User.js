// models/User.js
const mongoose = require('mongoose');

// Define the schema for the 'users' collection
const userSchema = new mongoose.Schema(
    {
      name: { type: String, required: true },
      email: { type: String, required: true, unique: true },
      gender: { type: String, required: true },
      dob: { type: Date, required: true },
      password: { type: String, required: true },
      status: {
        type: String,
        enum: ['offline', 'online', 'isSearching', 'inCall'],
        default: 'offline'
      },
    },
    { collection: 'users' } // Make sure this model is linked to the 'users' collection
  );
  
  
  // Create a Mongoose model based on the schema
  const User = mongoose.model('User', userSchema);
  

module.exports = User;
