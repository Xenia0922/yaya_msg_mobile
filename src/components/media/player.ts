export function getPlayerHtml(streamUrl: string, posterUrl?: string): string {
  const poster = posterUrl || '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#000;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;overflow:hidden}
  #player-wrapper{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
  video{width:100%;height:auto;max-height:100vh;background:#000}
  #loading{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#5a5a5a;font-size:14px;font-family:sans-serif}
  .spinner{border:2px solid #333;border-top:2px solid #ff6f91;border-radius:50%;width:24px;height:24px;animation:spin 1s linear infinite;margin:0 auto 8px}
  @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
  #error{display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ff4444;font-size:13px;font-family:sans-serif;text-align:center;padding:16px;line-height:1.6}
</style>
<script src="https://cdn.jsdelivr.net/npm/flv.js@1.6.2/dist/flv.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.4.0/dist/hls.min.js"></script>
</head>
<body>
<div id="player-wrapper">
  <video id="video" controls autoplay playsinline webkit-playsinline poster="${poster}"></video>
  <div id="loading">
    <div class="spinner"></div>
    <div>加载中...</div>
  </div>
  <div id="error"></div>
</div>
<script>
(function() {
  var video = document.getElementById('video');
  var loading = document.getElementById('loading');
  var errorDiv = document.getElementById('error');

  function showError(msg) {
    loading.style.display = 'none';
    errorDiv.style.display = 'block';
    errorDiv.textContent = msg;
  }

  function hideLoading() {
    loading.style.display = 'none';
  }

  var url = ${JSON.stringify(streamUrl)};
  var ext = url.split('?')[0].split('#')[0].toLowerCase();

  function tryNative() {
    video.src = url;
    video.load();
    video.play().then(function() {
      hideLoading();
    }).catch(function(e) {
      showError('网页原生播放失败: ' + e.message);
    });
  }

  try {
    if (ext.endsWith('.m3u8') || url.indexOf('m3u8') > -1 || url.indexOf('.ts') > -1) {
      if (window.Hls && Hls.isSupported()) {
        var hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
          hideLoading();
          video.play().catch(function(){});
        });
        hls.on(Hls.Events.ERROR, function(evt, data) {
          if (data.fatal) {
            showError('HLS 加载失败');
            hls.destroy();
          }
        });
      } else {
        tryNative();
      }
    } else if (ext.endsWith('.flv') || url.indexOf('flv') > -1) {
      if (window.flvjs && flvjs.isSupported()) {
        var flv = flvjs.createPlayer({
          type: 'flv',
          url: url,
          isLive: true,
          hasAudio: true,
          hasVideo: true,
          enableStashBuffer: false,
          stashInitialSize: 128
        });
        flv.attachMediaElement(video);
        flv.load();
        flv.play().then(function() {
          hideLoading();
        }).catch(function(e) {
          showError('FLV 播放失败: ' + e.message);
        });
        flv.on(flvjs.Events.ERROR, function() {
          showError('FLV 加载失败');
          flv.destroy();
        });
      } else {
        tryNative();
      }
    } else {
      tryNative();
    }
  } catch(e) {
    showError('网页播放器异常: ' + e.message);
  }
})();
</script>
</body>
</html>`;
}

export default { getPlayerHtml };
