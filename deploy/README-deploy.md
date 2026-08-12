# CHAMP Spot Tool — Manual Deployment Guide

This guide covers deploying the CHAMP Spot Tool manually on a server (e.g., Linux VM, EC2 instance) using **PM2** for process management and an external database (MySQL/PostgreSQL).

---

## 1. Prerequisites

- **Node.js**: v20 or v22
- **Database**: MySQL or PostgreSQL database running and accessible.
- **PM2**: Installed globally (`npm install -g pm2`)
- **Git**: To clone the repository

## 2. Server Setup

1. **Clone the repository** to your server:
   ```bash
   git clone https://github.com/AcceleronSolutionsGit/Gainwell-Champ.git
   cd Gainwell-Champ
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the application**:
   The application requires building both the backend server and the frontend web app.
   ```bash
   npm run build
   ```

## 3. Environment Configuration

1. Create your `.env` file in the root directory:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file with your specific production values. Since you are using a database, ensure you set the correct database connection string:
   ```env
   NODE_ENV=production
   PORT=8080

   # Database Configuration (MySQL example)
   DATABASE_CLIENT=mysql2
   DATABASE_URL=mysql://root:password@127.0.0.1:3306/champ_db

   # Session secret (Generate a secure random string)
   SESSION_SECRET=your_secure_random_string_here

   # Email Configuration
   ALLOWED_EMAIL_DOMAIN=gainwellengineering.com,acceleronsolutions.io
   ADMIN_EMAILS=your.email@domain.com
   EMAIL_PROVIDER=smtp
   # Add your SMTP variables here if using SMTP, or use 'console' for testing.

   # Meta WhatsApp Cloud API Configuration
   WHATSAPP_PROVIDER=meta
   META_WA_API_VERSION=v26.0
   META_WA_PHONE_NUMBER_ID=your_phone_number_id
   META_WA_TOKEN=your_permanent_access_token
   META_WA_APP_SECRET=your_app_secret
   META_WA_VERIFY_TOKEN=your_custom_verify_token
   ```

## 4. Run Migrations & Seed Data

Ensure your database tables are created. If this is a fresh database, run:
```bash
npm run seed:reset -w server
```
*Note: If you have existing data (like the MySQL database we migrated earlier), the tables and data are already present, so you can skip the reset script.*

## 5. Start with PM2

We use PM2 to keep the Node.js application running in the background, automatically restart it if it crashes, and manage logs. An `ecosystem.config.js` file is provided in the repository root.

1. **Start the application**:
   ```bash
   pm2 start ecosystem.config.js
   ```

2. **Save the PM2 process list** so it restarts automatically if the server reboots:
   ```bash
   pm2 save
   pm2 startup
   ```
   *(Follow the command outputted by `pm2 startup` to configure your OS init system).*

## 6. Managing the Deployment

- **View Logs**:
  ```bash
  pm2 logs champ-spot-tool
  ```

- **Restart the Server**:
  ```bash
  pm2 restart champ-spot-tool
  ```

- **Monitor Performance**:
  ```bash
  pm2 monit
  ```

## 7. Connecting Meta WhatsApp (Webhook)

Once your server is running and accessible via a public domain (usually behind an Nginx reverse proxy pointing to port 8080):

1. Go to your **Meta Developer Console** → **WhatsApp** → **Configuration**.
2. Click **Edit** on the Webhook.
3. Set the **Callback URL** to `https://<YOUR-DOMAIN>/webhook/whatsapp`
4. Set the **Verify Token** to the exact same string you put in the `META_WA_VERIFY_TOKEN` variable in your `.env` file.
5. Subscribe to the `messages` event.
