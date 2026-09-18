/**
 * Utilities for parsing Tweets and verifying X (Twitter) API v2 engagements.
 */

/**
 * Extracts username and tweet ID from Twitter/X URLs.
 * Supports both twitter.com and x.com formats.
 */
export function parseTweetUrl(url) {
  const regex = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/(\d+)/i;
  const match = url.match(regex);
  if (!match) return null;
  return {
    username: match[1],
    tweetId: match[2],
    cleanUrl: `https://x.com/${match[1]}/status/${match[2]}`,
  };
}

/**
 * Fetches comprehensive tweet metadata including high-resolution images/thumbnails,
 * author avatar, author display name, and full tweet text.
 * Uses the free public fxtwitter API with fallback to Twitter oEmbed.
 */
export async function fetchTweetMetadata(url, username, tweetId) {
  try {
    const fxUrl = `https://api.fxtwitter.com/${username || 'i'}/status/${tweetId}`;
    const res = await fetch(fxUrl, {
      headers: { 'User-Agent': 'QuestifyBot/1.0' },
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.tweet) {
        const t = data.tweet;
        const photo =
          t.media?.photos?.[0]?.url ||
          t.media?.all?.[0]?.url ||
          (t.media?.videos?.[0]?.thumbnail_url) ||
          null;

        return {
          authorName: t.author?.name || `@${t.author?.screen_name || username}`,
          authorUsername: t.author?.screen_name || username,
          authorAvatar: t.author?.avatar_url || null,
          text: t.text || '',
          mediaUrl: photo,
        };
      }
    }
  } catch (err) {
    console.warn('[FXTWITTER] Could not fetch from fxtwitter, falling back to oEmbed:', err.message);
  }

  // Fallback to Twitter oEmbed
  const oembed = await fetchTweetOEmbed(url);
  return {
    authorName: oembed?.authorName || `@${username}`,
    authorUsername: username,
    authorAvatar: null,
    text: oembed?.text || '',
    mediaUrl: null,
  };
}

/**
 * Fetches basic tweet metadata using Twitter's public oEmbed endpoint.
 * This does not require an API key and extracts author name and tweet HTML snippet.
 */
export async function fetchTweetOEmbed(url) {
  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
    const res = await fetch(oembedUrl);
    if (!res.ok) return null;
    const data = await res.json();

    // Extract text from the oEmbed html blockquote
    const htmlText = data.html || '';
    const textMatch = htmlText.match(/<p[^>]*>(.*?)<\/p>/s);
    let tweetText = textMatch ? textMatch[1] : '';
    // Strip inner HTML tags
    tweetText = tweetText.replace(/<[^>]+>/g, '').trim();

    return {
      authorName: data.author_name || 'X User',
      authorUrl: data.author_url || url,
      text: tweetText,
    };
  } catch (err) {
    console.warn('[OEMBED] Could not fetch tweet oembed:', err.message);
    return null;
  }
}

/**
 * Verifies if the linked Twitter user has liked or retweeted the target tweet.
 *
 * @param {Object} params
 * @param {string} params.accessToken - The user's OAuth2 access token
 * @param {string} params.twitterUserId - The user's numerical Twitter user ID
 * @param {string} params.tweetId - The ID of the target tweet
 * @param {'like' | 'retweet'} params.action - 'like' or 'retweet'
 * @returns {Promise<{ verified: boolean, message?: string }>}
 */
export async function verifyTwitterAction({ accessToken, twitterUserId, tweetId, action }) {
  if (!accessToken || !twitterUserId) {
    return { verified: false, message: 'Missing Twitter access token or user ID.' };
  }

  try {
    if (action === 'like') {
      // X API v2: GET /2/users/:id/liked_tweets
      const endpoint = `https://api.twitter.com/2/users/${twitterUserId}/liked_tweets?max_results=100`;
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[X API ERROR - LIKE]:', response.status, errorBody);
        return {
          verified: false,
          message: `X API returned error ${response.status}. Please ensure your X account permissions are active.`,
        };
      }

      const data = await response.json();
      const likedTweets = data.data || [];
      const hasLiked = likedTweets.some(t => t.id === tweetId);

      return {
        verified: hasLiked,
        message: hasLiked ? 'Verified!' : 'We could not find your Like on this tweet. Please like it and try again!',
      };
    }

    if (action === 'retweet') {
      // X API v2: GET /2/tweets/:id/retweeted_by
      // Note: Alternatively check user's timeline or retweeted_by
      const endpoint = `https://api.twitter.com/2/tweets/${tweetId}/retweeted_by`;
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[X API ERROR - RETWEET]:', response.status, errorBody);
        return {
          verified: false,
          message: `X API returned error ${response.status}. Please ensure your X account permissions are active.`,
        };
      }

      const data = await response.json();
      const retweeters = data.data || [];
      const hasRetweeted = retweeters.some(u => u.id === twitterUserId);

      return {
        verified: hasRetweeted,
        message: hasRetweeted ? 'Verified!' : 'We could not find your Retweet on this post. Please retweet and try again!',
      };
    }

    if (action === 'comment') {
      // X API v2: Check user tweets that reply to this conversation
      const endpoint = `https://api.twitter.com/2/users/${twitterUserId}/tweets?tweet.fields=conversation_id,in_reply_to_user_id&max_results=50`;
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[X API ERROR - COMMENT]:', response.status, errorBody);
        return {
          verified: false,
          message: `X API returned error ${response.status}. Please ensure your X account permissions are active.`,
        };
      }

      const data = await response.json();
      const userTweets = data.data || [];
      const hasCommented = userTweets.some(t => t.conversation_id === tweetId);

      return {
        verified: hasCommented,
        message: hasCommented ? 'Verified!' : 'We could not find your Comment / Reply on this post. Please reply and try again!',
      };
    }

    return { verified: false, message: 'Unsupported action type.' };
  } catch (error) {
    console.error('[X API EXCEPTION]:', error);
    return { verified: false, message: 'Error communicating with X (Twitter) API.' };
  }
}
