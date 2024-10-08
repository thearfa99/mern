require("dotenv").config();
const postmark = require("postmark");
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
// const bcrypt = require("bcrypt");

const { authenticateToken } = require("./utilities.js");
const User = require("./models/user.model.js");
const Task = require("./models/task.model.js");
const config = require("./config.json");

const app = express();

// Postmark client set up
const postmarkClient = new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);

//To ensure password lenght of 6 char and 1 special char
const validatePassword = (password) => {
    const minLength = 6;
    const specialCharPattern = /[!@#$%^&*(),.?":{}|<>]/;
    
    if (password.length < minLength) {
      return false;
    }
    if (!specialCharPattern.test(password)) {
      return false;
    }
    return true;
  };

app.listen(8000, () => {
    console.log('Server started on port 8000');
});

mongoose.connect(config.connectionString);

app.use(express.json());
app.use(cors({ origin: "*" }));

app.get("/", (req, res) => {
    res.json({ data: "hello" });
});

// Create Account API
app.post("/create-account", async (req, res) => {
    const { fullName, email, password } = req.body;

    if (!fullName.trim() || !email.trim() || !password.trim()) {
        return res.status(400).json({ error: true, message: "All fields are required" });
    }

    if (validatePassword(password) === false){
        return res.status(400).json({ error: true, message: "Password does not meet requirements" });
    }

    const isUser = await User.findOne({ email });
    if (isUser) {
        return res.status(400).json({ error: true, message: "User already exists" });
    }

    const user = new User({ fullName, email, password });
    
    await user.save();

    const accessToken = jwt.sign({ user }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "10h" });

    return res.json({ error: false, user, accessToken, message: "Registration Successful" });
});

// Login API
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "All fields are required" });
    }

    const userInfo = await User.findOne({ email });
    if (!userInfo) {
        return res.status(400).json({ message: "User not found" });
    }

    if (password !== userInfo.password) {
        return res.status(400).json({ message: "Invalid Credentials" });
    }

    const user = { user: userInfo };
    const accessToken = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "10h" });

    return res.json({ error: false, message: "Login Successful", email, accessToken });
});

// Get User API
app.get("/get-user", authenticateToken, async (req, res) => {
    const { user } = req.user;

    const isUser = await User.findOne({ _id: user._id });

    if (!isUser) {
        return res.sendStatus(401);
    }

    return res.json({
        user: { fullName: isUser.fullName, email: isUser.email, "_id": isUser._id, createdOn: isUser.createdOn },
        message: "",
    });
});

// Get All Tasks
app.get("/tasks", authenticateToken, async (req, res) => {
    const { user } = req.user;

    try {
        const tasks = await Task.find({ userId: user._id });
        return res.json({
            error: false,
            tasks,
            message: "Tasks fetched successfully",
        });
    } catch (error) {
        return res.status(500).json({
            error: true,
            message: "Internal Server Error",
        });
    }
})

// Add Task API
app.post("/add-task", authenticateToken, async (req, res) => {
    const { text, isComplete, description } = req.body;
    const { user } = req.user;

    if (!text.trim()) {
        return res.status(400).json({ error: true, message: "Please add a task" });
    }

    try {
        const task = new Task({
            text,
            isComplete: isComplete ?? false,
            userId: user._id,
            createdTime: new Date(),  // Set createdTime to now
            description
        });
        await task.save();
        return res.json({
            error: false,
            task,
            message: "Task added successfully",
        });
    } catch (error) {
        return res.status(500).json({
            error: true,
            message: "Internal Server Error",
        });
    }
});

// Update Task API
app.post("/update-task/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { isComplete, description } = req.body;

    try {
        let update = { isComplete: isComplete, description: description };

        if (isComplete) {
            update.completedTime = new Date();  // Set completedTime to now
        } else {
            update.completedTime = null;  // Clear completedTime
        }

        const task = await Task.findOneAndUpdate(
            { _id: id },
            update,
            { new: true },
        );

        if (!task) {
            return res.status(404).json({
                error: true,
                message: "Task not found or unauthorized",
            });
        }

        if (isComplete) {
            const user = await User.findById(task.userId);
            const mailOptions = {
                From: process.env.EMAIL_USER,
                To: user.email,
                Subject: 'Task Completed',
                TextBody: `Your task "${task.text}" has been marked as completed.\n\nCreated: ${new Date(task.createdTime).toLocaleString()}\nCompleted: ${new Date(task.completedTime).toLocaleString()}`
            };

            postmarkClient.sendEmail(mailOptions, (error, result) => {
                if (error) {
                    console.error('Error sending email:', error);
                    return res.status(500).json({
                        error: true,
                        message: "Error sending email",
                    });
                } else {
                    console.log('Email sent:', result);
                    return res.json({
                        error: false,
                        task,
                        message: "Task updated and email sent successfully",
                    });
                }
            });
        } else {
            return res.json({
                error: false,
                task,
                message: "Task updated successfully",
            });
        }
    } catch (error) {
        return res.status(500).json({
            error: true,
            message: error.message || "Internal Server Error",
        });
    }
});

// Delete Task API
app.delete("/delete-task/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;

    try {
        const task = await Task.findOneAndDelete({ _id: id, userId: req.user.user._id });

        if (!task) {
            return res.status(404).json({
                error: true,
                message: "Task not found or unauthorized",
            });
        }

        return res.json({
            error: false,
            message: "Task deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting task:", error);
        return res.status(500).json({
            error: true,
            message: "Internal Server Error",
        });
    }
});

module.exports = app;

