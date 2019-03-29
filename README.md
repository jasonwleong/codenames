# Codenames
Final project for CS 158A (Computer Networks) in Spring 18 at SJSU with Professor Mortezaei. Created by Jason Leong, Patrick Leung, and Hangyi Gu.

# Link
https://tinyurl.com/y99lvefx (dead)

# Description
This project was built using node.js, socket.io, express, and jQuery libraries. The Client code lives on the html page, which servers game.js (`public/js/game.js`). The Server code can be found at `server.js`.


# Setup (local)
```
npm install
node server.js
```

# Setup on AWS EC2
- install c compiler (if not present)
- install node (curl nvm -> nvm install node)
- cd to this repo
- npm install
- nohup nodemon server.js &
