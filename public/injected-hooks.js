/* eslint-disable no-underscore-dangle */

(() => {
  if (window.__VK_PAGE_HOOKS_INSTALLED__) return;
  window.__VK_PAGE_HOOKS_INSTALLED__ = true;

  const GraphQLPattern =
    /^(?:\/i\/api)?\/graphql\/[^/]+\/(TweetDetail|TweetResultByRestId|UserTweets|UserMedia|HomeTimeline|HomeLatestTimeline|UserTweetsAndReplies|UserHighlightsTweets|UserArticlesTweets|Bookmarks|Likes|CommunitiesExploreTimeline|ListLatestTweetsTimeline)$/;
  const TweetConfigPattern = /^(?:\/i\/api)?\/1\.1\/videos?\/tweet\/config\//;

  function validateUrl(u) {
    try {
      return new URL(u);
    } catch (_) {
      try {
        return u instanceof URL ? u : undefined;
      } catch (_) {
        return undefined;
      }
    }
  }

  function shouldCapture(pathname) {
    return GraphQLPattern.test(pathname) || TweetConfigPattern.test(pathname);
  }

  function dispatch(path, method, body, status) {
    try {
      const event = new CustomEvent("mh:media-response", {
        detail: { path, method, body, status },
      });
      document.dispatchEvent(event);
    } catch (_) {}
  }

  if (!XMLHttpRequest.prototype.open.__VK_WRAPPED__) {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = new Proxy(originalOpen, {
      apply(target, thisArg, args) {
        const [method, url] = args;
        const parsed =
          validateUrl(url) ||
          (typeof url === "string" ? new URL(url, location.origin) : undefined);
        if (parsed && shouldCapture(parsed.pathname)) {
          thisArg.addEventListener("load", function () {
            try {
              if (this.status === 200) {
                dispatch(
                  parsed.pathname,
                  method,
                  this.responseText,
                  this.status,
                );
              }
            } catch (_) {}
          });
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    XMLHttpRequest.prototype.open.__VK_WRAPPED__ = true;
  }

  if (!window.fetch.__VK_WRAPPED__) {
    const originalFetch = window.fetch;
    window.fetch = new Proxy(originalFetch, {
      apply(target, thisArg, args) {
        try {
          const [input, init] = args;
          const method = (init && init.method) || "GET";
          let href;
          if (typeof input === "string") {
            href = input;
          } else if (input && typeof input.url === "string") {
            href = input.url;
          }
          const parsed = href
            ? validateUrl(href) || new URL(href, location.origin)
            : undefined;
          if (parsed && shouldCapture(parsed.pathname)) {
            return Reflect.apply(target, thisArg, args).then(async (resp) => {
              try {
                if (resp.status === 200) {
                  const cloned = resp.clone();
                  const text = await cloned.text();
                  dispatch(parsed.pathname, method, text, resp.status);
                }
              } catch (_) {}
              return resp;
            });
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
    window.fetch.__VK_WRAPPED__ = true;
  }
  if (!window.__VK_ORIGINAL_CREATE_OBJECT_URL__) {
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = function (...args) {
      try {
        const url = originalCreate.apply(this, args);
        if (url && /^blob:/i.test(url)) {
          const payload = { url, args: [] };
          try {
            if (args[0] instanceof MediaSource) {
              payload.type = "MediaSource";
            } else if (args[0] instanceof Blob) {
              payload.type = args[0].type || "Blob";
            }
          } catch (_) {}
          const event = new CustomEvent("mh:media-blob", {
            detail: payload,
          });
          document.dispatchEvent(event);
        }
        return url;
      } catch (error) {
        throw error;
      }
    };
    window.__VK_ORIGINAL_CREATE_OBJECT_URL__ = true;
  }
})();
