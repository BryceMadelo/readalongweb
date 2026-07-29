# Remote Access Guide (Cloudflare Tunnel)

This guide will walk you through setting up a Cloudflare Tunnel so you can access your self-hosted ReadAlong server securely from the public internet without opening ports on your home router.

## Prerequisites

1.  **Domain Name**: You must own a domain name (e.g., `readalong.app`). If you don't have one, you can often get them for free (e.g., via the GitHub Student Developer Pack on Name.com) or buy a cheap one from a registrar.
2.  **Cloudflare Account**: Create a free account at [Cloudflare](https://dash.cloudflare.com/sign-up).
3.  **Nameservers Pointed to Cloudflare**:
    *   In your domain registrar's dashboard (e.g., Name.com), change your domain's nameservers to the ones provided by Cloudflare during the setup process.
    *   Wait for the DNS propagation to complete (this can take a few minutes to a few hours). Cloudflare will notify you when it's active.

## Step-by-Step Tunnel Setup

We will create a "Named Tunnel" via the Cloudflare Zero Trust dashboard.

1.  **Access Zero Trust**: Log in to your Cloudflare dashboard, select your domain, and click on **Zero Trust** in the left sidebar. (You may need to follow a quick onboarding for Zero Trust if it's your first time).
2.  **Create Tunnel**:
    *   Navigate to **Networks** -> **Tunnels**.
    *   Click the **Create a tunnel** button.
    *   Select **Cloudflared** as the connector type and click Next.
    *   Give your tunnel a name (e.g., `readalong-tunnel`) and click **Save tunnel**.
3.  **Get the Tunnel Token**:
    *   On the "Install and run a connector" page, you will see a list of commands for various operating systems.
    *   Look at the Docker command. It will look something like this: `docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJ...`
    *   **Copy the token string** (the long alphanumeric string starting with `ey...` that comes after `--token`).
    *   Save this token; you will need it shortly.
    *   Do *not* run the Docker command manually, we will configure Docker Compose to do this for you.
4.  **Route Traffic (Public Hostname)**:
    *   Click **Next** in the Cloudflare dashboard to go to the "Route traffic" step.
    *   Click **Add a public hostname**.
    *   **Subdomain**: Enter a subdomain if you want one (e.g., `app`). Leave blank for the root domain.
    *   **Domain**: Select your domain from the dropdown (e.g., `readalong.app`).
    *   **Service**:
        *   Type: Select **HTTP**.
        *   URL: Enter `readalong-server:3000`. (This works because Cloudflared and ReadAlong are in the same Docker Compose network).
    *   Click **Save hostname**.

## Starting the Stack

You now have a permanent Tunnel configured in Cloudflare.

1.  Open the terminal on your host machine and navigate to the `web-app` directory.
2.  Create or edit your `.env` file (the same one where you set `API_TOKEN`).
3.  Add the `TUNNEL_TOKEN` you copied earlier, and set `APP_DOMAIN` to your public hostname:
    ```env
    API_TOKEN=your_secure_api_token
    TUNNEL_TOKEN=eyJ...your_long_token_here...
    APP_DOMAIN=https://app.yourdomain.com
    ```
4.  Start the stack using Docker Compose:
    ```bash
    docker-compose up -d
    ```
5.  Wait a moment for the containers to start. You should now be able to visit `https://app.yourdomain.com` and see the ReadAlong UI!

## Sharing Access

*   Because the app is now public, it utilizes the built-in multi-user authentication.
*   To share access with a friend, simply give them the URL (`https://app.yourdomain.com`).
*   They will need to use the "Sign Up" page to create their own account.
*   **Rate Limiting**: To prevent brute-force attacks, the login and signup endpoints are rate-limited.
*   **Privacy**: Accounts are fully isolated. They will not see your books, and you will not see theirs.
*   **Queueing**: Heavy tasks (like importing and transcribing audio) are processed one at a time globally. If multiple people upload books simultaneously, they will wait in a unified queue.
*   **Downtime**: Be aware that if you pull updates, rebuild the container, or restart your server, the application will be temporarily unavailable for anyone using it. Let your friends know to expect occasional short outages!
