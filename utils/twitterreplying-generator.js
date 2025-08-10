const axios = require('axios');
const { createCanvas, loadImage } = require('canvas');

async function loadImageWithAxios(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });
  const buffer = Buffer.from(response.data, 'binary');
  return loadImage(buffer);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function tokenize(text) {
  const tokens = String(text || '').split(/\s+/);
  return tokens.map((tok) => {
    if (/^(https?:\/\/[^\s]+)/i.test(tok)) return { text: tok, type: 'url' };
    if (/^@\w+/.test(tok)) return { text: tok, type: 'mention' };
    if (/^#\w+/.test(tok)) return { text: tok, type: 'hashtag' };
    return { text: tok, type: 'normal' };
  });
}

function layoutStyledLines(ctx, tokens, maxWidth) {
  const spaceWidth = ctx.measureText(' ').width;
  const lines = [];
  let current = [];
  function widthOf(line) {
    if (line.length === 0) return 0;
    const textWidth = line.reduce((w, t) => w + ctx.measureText(t.text).width, 0);
    return textWidth + spaceWidth * (line.length - 1);
  }
  for (const token of tokens) {
    const next = [...current, token];
    if (widthOf(next) > maxWidth && current.length > 0) {
      lines.push(current);
      current = [token];
    } else {
      current = next;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function drawStyledLines(ctx, lines, x, y, lineHeight) {
  for (let i = 0; i < lines.length; i++) {
    let drawX = x;
    for (const token of lines[i]) {
      if (token.type === 'url' || token.type === 'mention' || token.type === 'hashtag') {
        ctx.fillStyle = '#1DA1F2';
      } else {
        ctx.fillStyle = '#E1E8ED';
      }
      ctx.fillText(token.text, drawX, y + i * lineHeight);
      drawX += ctx.measureText(token.text).width + ctx.measureText(' ').width;
    }
  }
}

async function generateTwitterReplyImage({
  profilePicUrl,
  username,
  handle,
  replyToHandle, // e.g., 'historyinmemes'
  tweetText,
  tweetImageUrl,
  verificationType = null,
  affiliatedIconUrl = null,
}) {
  const width = 2400;
  const padding = 80;
  const avatarSize = 160;
  const maxTextWidth = width - padding * 2;
  const bodyFontPx = 72;
  const lineHeight = Math.round(bodyFontPx * 1.25);
  const MAX_BANNER_HEIGHT = 1000;

  const measureCanvas = createCanvas(width, 200);
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = `${bodyFontPx}px Arial`;
  const tokens = tokenize(tweetText);
  const lines = layoutStyledLines(measureCtx, tokens, maxTextWidth);
  const textHeight = lines.length * lineHeight;

  const replyFontPx = Math.round(bodyFontPx * 0.8);
  const replyLineHeight = Math.round(replyFontPx * 1.1);

  let bannerHeight = 0;
  if (tweetImageUrl) {
    try {
      const head = await loadImageWithAxios(tweetImageUrl);
      const bannerWidth = width - padding * 2;
      bannerHeight = Math.min(MAX_BANNER_HEIGHT, Math.round(bannerWidth * (head.height / head.width)));
    } catch {}
  }

  const headerGap = 100;
  const tweetTextY = padding + avatarSize + headerGap + replyLineHeight + 30;
  const height = tweetTextY + textHeight + bannerHeight + 80;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bgRadius = 60;
  ctx.fillStyle = '#15202B';
  roundRect(ctx, 0, 0, width, height, bgRadius);
  ctx.fill();

  try {
    if (profilePicUrl) {
      const avatar = await loadImageWithAxios(profilePicUrl);

        ctx.save();
        ctx.beginPath();
        ctx.arc(padding + avatarSize / 2, padding + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, padding, padding, avatarSize, avatarSize);
        ctx.restore();
      
    }
  } catch {}

  const textX = padding + avatarSize + 40;
  const usernameY = padding + 70;
  const handleY = usernameY + 80;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 72px Arial';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(username, textX, usernameY);

  const nameMetrics = ctx.measureText(username);
  const ascent = nameMetrics.actualBoundingBoxAscent || 72;
  const computedBadgeSize = Math.round(ascent * 1.25);
  const nameCenterY = usernameY - ascent / 2;

  let badgeUrl = '';
  if (verificationType === 'blue') {
    badgeUrl = 'https://upload.wikimedia.org/wikipedia/commons/archive/1/12/20241227105040%21Verification-badge.png';
  } else if (verificationType === 'grey') {
    badgeUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Twitter_Verified_Badge_Gray.svg/1024px-Twitter_Verified_Badge_Gray.svg.png';
  } else if (verificationType === 'gold') {
    badgeUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Twitter_Verified_Badge_Gold.svg/1024px-Twitter_Verified_Badge_Gold.svg.png';
  }
  let badgeX = 0;
  if (badgeUrl) {
    try {
      const badgeImg = await loadImageWithAxios(badgeUrl);
      const usernameWidth = nameMetrics.width;
      badgeX = textX + usernameWidth + 14;
      const badgeY = Math.round(nameCenterY - computedBadgeSize / 2);
      ctx.drawImage(badgeImg, badgeX, badgeY, computedBadgeSize, computedBadgeSize);
    } catch {}
  }

  if (affiliatedIconUrl) {
    try {
      const iconSize = computedBadgeSize;
      const affiliatedIcon = await loadImageWithAxios(affiliatedIconUrl);
      const baseX = (badgeUrl ? badgeX + computedBadgeSize + 14 : textX + nameMetrics.width + 14);
      const iconY = Math.round(nameCenterY - iconSize / 2);
      ctx.save();
      ctx.strokeStyle = '#8899A6';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(baseX - 1, iconY - 1, iconSize + 2, iconSize + 2);
      ctx.drawImage(affiliatedIcon, baseX, iconY, iconSize, iconSize);
      ctx.restore();
    } catch {}
  }

  ctx.fillStyle = '#8899A6';
  ctx.font = '64px Arial';
  ctx.fillText(`@${handle}`, textX, handleY);

  const replyX = padding;
  const replyY = padding + avatarSize + headerGap; // baseline for reply
  ctx.font = `${replyFontPx}px Arial`;
  ctx.fillStyle = '#8899A6';
  const prefix = 'Replying to ';
  ctx.fillText(prefix, replyX, replyY);
  const prefixWidth = ctx.measureText(prefix).width;
  ctx.fillStyle = '#1DA1F2';
  ctx.fillText(`@${replyToHandle}`, replyX + prefixWidth, replyY);

  ctx.fillStyle = '#E1E8ED';
  ctx.font = `${bodyFontPx}px Arial`;
  drawStyledLines(ctx, lines, padding, tweetTextY, lineHeight);
  
  if (tweetImageUrl && bannerHeight > 0) {
    try {
      const img = await loadImageWithAxios(tweetImageUrl);
      const bannerWidth = width - padding * 2;
      const imageAspect = img.width / img.height;
      const bannerAspect = bannerWidth / bannerHeight;
      let sx, sy, sWidth, sHeight;
      if (imageAspect > bannerAspect) {
        sHeight = img.height;
        sWidth = sHeight * bannerAspect;
        sx = (img.width - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = img.width;
        sHeight = sWidth / bannerAspect;
        sx = 0;
        sy = (img.height - sHeight) / 2;
      }
      const bannerY = tweetTextY + textHeight;
      ctx.drawImage(img, sx, sy, sWidth, sHeight, padding, bannerY, bannerWidth, bannerHeight);
    } catch {}
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateTwitterReplyImage };


