(function () {
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.getElementById('nav-menu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function () {
      const open = navMenu.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });

    navMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navMenu.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navMenu.classList.contains('open')) {
        navMenu.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.focus();
      }
    });
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(function ([k, v]) {
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (child) {
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else if (child) node.appendChild(child);
    });
    return node;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (_) {
      return '';
    }
  }

  fetch('data/now.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.live) {
        const live = document.getElementById('live-badge');
        if (live) live.hidden = false;
      }
    })
    .catch(function () {});

  fetch('https://api.github.com/users/josephburt/repos?per_page=100&sort=updated')
    .then(function (r) { return r.json(); })
    .then(function (repos) {
      const grid = document.getElementById('projects-grid');
      if (!grid || !Array.isArray(repos)) return;

      const publicRepos = repos
        .filter(function (repo) { return !repo.fork && !repo.private; })
        .sort(function (a, b) {
          return new Date(b.updated_at) - new Date(a.updated_at);
        });

      if (!publicRepos.length) {
        grid.appendChild(el('p', { className: 'projects-empty', text: 'No public repositories found.' }));
        return;
      }

      publicRepos.forEach(function (repo) {
        const language = repo.language ? '// ' + repo.language.toLowerCase() : '// repo';
        const stars = repo.stargazers_count > 0 ? '★ ' + repo.stargazers_count : 'public';
        const description = repo.description || 'No description provided.';

        const card = el('a', {
          className: 'project',
          href: repo.html_url,
          target: '_blank',
          rel: 'noopener'
        }, [
          el('div', { className: 'top' }, [
            el('span', { className: 'label', text: language }),
            el('span', { className: 'status', text: stars })
          ]),
          el('h3', { text: repo.name }),
          el('p', { text: description })
        ]);
        grid.appendChild(card);
      });
    })
    .catch(function () {
      const grid = document.getElementById('projects-grid');
      if (grid) {
        grid.appendChild(el('p', { className: 'projects-empty', text: 'Could not load repositories from GitHub.' }));
      }
    });

  const YOUTUBE_CHANNEL_ID = 'UCL0Gvu2R42sKsmmLSIC0kHA';
  const YOUTUBE_RSS =
    'https://www.youtube.com/feeds/videos.xml?channel_id=' + YOUTUBE_CHANNEL_ID;
  const YOUTUBE_FEED_API =
    'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(YOUTUBE_RSS);

  function youtubeIdFromLink(link) {
    if (!link) return '';
    const match = link.match(/[?&]v=([^&]+)/);
    return match ? match[1] : '';
  }

  function renderVideos(videos) {
    const grid = document.getElementById('videos-grid');
    if (!grid) return;
    grid.textContent = '';

    if (!videos.length) {
      grid.appendChild(el('p', { className: 'videos-empty', text: 'No videos found on the channel.' }));
      return;
    }

    videos.slice(0, 3).forEach(function (video, i) {
      const card = el('a', {
        className: 'video-card' + (i === 0 ? ' featured' : ''),
        href: video.url,
        target: '_blank',
        rel: 'noopener'
      }, [
        el('div', { className: 'thumb' }, [
          el('img', { src: video.thumbnail, alt: '', loading: 'lazy' })
        ]),
        el('div', { className: 'video-body' }, [
          el('span', { className: 'label', text: i === 0 ? '// latest' : '// archive' }),
          el('h3', { text: video.title }),
          el('span', { className: 'date', text: formatDate(video.published) })
        ])
      ]);
      grid.appendChild(card);
    });
  }

  fetch(YOUTUBE_FEED_API)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || data.status !== 'ok' || !Array.isArray(data.items)) {
        throw new Error('Invalid YouTube feed response');
      }

      const videos = data.items.map(function (item) {
        const id = youtubeIdFromLink(item.link);
        return {
          title: item.title || 'Untitled video',
          url: item.link,
          published: item.pubDate,
          thumbnail: item.thumbnail || (id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : '')
        };
      });

      renderVideos(videos);
    })
    .catch(function () {
      const grid = document.getElementById('videos-grid');
      if (grid) {
        grid.appendChild(el('p', { className: 'videos-empty', text: 'Could not load videos from YouTube.' }));
      }
    });
})();
