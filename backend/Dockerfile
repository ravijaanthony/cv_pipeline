# Use a lightweight Node.js 18 image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first
# This helps Docker cache your dependencies so builds are faster
COPY package*.json ./

# Install the dependencies
RUN npm install

# Copy the rest of your backend code into the container
COPY . .

# Expose the default port the app falls back to inside the container
EXPOSE 10000

# Start the server using the npm start script we created earlier
CMD ["npm", "start"]
