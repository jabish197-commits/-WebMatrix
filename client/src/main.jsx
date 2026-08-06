import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
const API = import.meta.env.DEV
    ? import.meta.env.VITE_API_URL || "/api"
    : "/api",
  AuthContext = createContext(null),
  CartContext = createContext(null),
  ThemeContext = createContext(null);
const rolePath = {
  super_admin: "/super-admin",
  admin: "/admin",
  customer: "/customer",
};
function readStoredJson(key, fallback, storage = localStorage) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    storage.removeItem(key);
    return fallback;
  }
}
function readStoredUser() {
  const savedUser = readStoredJson("webmatrix_user", null, sessionStorage);
  if (!savedUser || !rolePath[savedUser.role]) {
    sessionStorage.removeItem("webmatrix_user");
    sessionStorage.removeItem("webmatrix_token");
    return null;
  }
  return savedUser;
}
const go = (path) => {
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
};
const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value));
async function readResponse(response, fallbackMessage) {
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (response.ok) throw new Error("The API returned an invalid response");
    }
  }
  if (!response.ok) {
    throw new Error(
      data.message ||
        (response.status >= 500
          ? "WebMatrix API is unavailable. Restart WebMatrix and try again."
          : fallbackMessage),
    );
  }
  return data;
}
async function request(path, options = {}) {
  const token = sessionStorage.getItem("webmatrix_token");
  const fetchOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  };
  let response;
  let networkError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(`${API}${path}`, fetchOptions);
      if (response.status < 500 || attempt === 3) break;
    } catch (error) {
      networkError = error;
      if (attempt === 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  if ((!response || response.status >= 500) && API.startsWith("/")) {
    try {
      response = await fetch(`http://127.0.0.1:5000/api${path}`, fetchOptions);
    } catch (error) {
      networkError = error;
    }
  }
  if (!response)
    throw networkError || new Error("WebMatrix API is unavailable");
  return readResponse(response, "Request failed");
}
async function uploadImage(file, folder) {
  const token = sessionStorage.getItem("webmatrix_token"),
    body = new FormData();
  body.append("image", file);
  body.append("folder", folder);
  const response = await fetch(`${API}/uploads/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    }),
    data = await readResponse(response, "Image upload failed");
  return data.url;
}
async function deleteImage(url) {
  return request("/uploads/image", {
    method: "DELETE",
    body: JSON.stringify({ url }),
  });
}
function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("Razorpay Checkout could not load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Razorpay Checkout could not load. Check your internet connection."));
    document.head.appendChild(script);
  });
}
function Providers({ children }) {
  const [user, setUser] = useState(readStoredUser),
    [cart, setCart] = useState(() => {
      const savedCart = readStoredJson("webmatrix_cart", []);
      return Array.isArray(savedCart) ? savedCart : [];
    }),
    [settings, setSettings] = useState(null),
    [settingsError, setSettingsError] = useState("");
  useEffect(() => {
    sessionStorage.removeItem("webmatrix_recovery_attempted");
    localStorage.removeItem("webmatrix_user");
    localStorage.removeItem("webmatrix_token");
    localStorage.removeItem("webmatrix_welcome");
  }, []);
  const acceptSession = (data) => {
      sessionStorage.setItem("webmatrix_token", data.token);
      sessionStorage.setItem("webmatrix_user", JSON.stringify(data.user));
      sessionStorage.setItem("webmatrix_welcome", data.welcomeMessage || "");
      setUser(data.user);
      return data.user;
    },
    login = async (email, password) => {
      const data = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      return acceptSession(data);
    },
    logout = () => {
      sessionStorage.removeItem("webmatrix_token");
      sessionStorage.removeItem("webmatrix_user");
      sessionStorage.removeItem("webmatrix_welcome");
      setUser(null);
    };
  useEffect(
    () => localStorage.setItem("webmatrix_cart", JSON.stringify(cart)),
    [cart],
  );
  useEffect(() => {
    if (!sessionStorage.getItem("webmatrix_token")) return;
    request("/auth/me")
      .then(({ user: verifiedUser }) => {
        sessionStorage.setItem("webmatrix_user", JSON.stringify(verifiedUser));
        setUser(verifiedUser);
      })
      .catch(() => {
        sessionStorage.removeItem("webmatrix_token");
        sessionStorage.removeItem("webmatrix_user");
        setUser(null);
      });
  }, []);
  useEffect(() => {
    let retryTimer;
    let stopped = false;
    const loadSettings = () =>
      request("/settings/public")
        .then((data) => {
          if (stopped) return;
          setSettings(data);
          setSettingsError("");
          const root = document.documentElement,
            vars = {
              "--store-font": `'${data.storefrontFont || "DM Sans"}',sans-serif`,
              "--store-text": data.storefrontTextColor || "#152018",
              "--store-bg": data.storefrontBackgroundColor || "#f7f5ef",
              "--header-bg": data.headerBackgroundColor || "#fffdf8",
              "--hero-start": data.heroStartColor || "#f4efe4",
              "--hero-end": data.heroEndColor || "#e6eee3",
              "--circle": data.circleColor || "#e7a93f",
              "--shop-button": data.buttonColor || "#18251b",
              "--shop-button-text": data.buttonTextColor || "#fff",
              "--collection-bg": data.collectionBackgroundColor || "#f7f5ef",
              "--card-bg": data.cardBackgroundColor || "#fff",
              "--card-border": data.cardBorderColor || "#e8e5dc",
              "--card-border-style": data.cardBorderStyle || "solid",
              "--card-border-width": `${data.cardBorderWidth ?? 1}px`,
              "--card-radius": `${data.cardRadius ?? 18}px`,
              "--cards-per-row": data.cardsPerRow || 3,
              "--store-background-image": data.backgroundImageUrl
                ? `url("${data.backgroundImageUrl}")`
                : "none",
              "--hero-banner-image": data.bannerUrl
                ? `url("${data.bannerUrl}")`
                : "linear-gradient(120deg,var(--hero-start),var(--hero-end))",
            };
          Object.entries(vars).forEach(([key, value]) =>
            root.style.setProperty(key, value),
          );
        })
        .catch(() => {
          if (stopped) return;
          setSettingsError(
            "Store API is unavailable. Retrying automatically every 3 seconds...",
          );
          retryTimer = setTimeout(loadSettings, 3000);
        });
    loadSettings();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
    };
  }, []);
  const add = (product, amount = 1) =>
    setCart((items) => {
      const found = items.find((x) => x.id === product.id);
      return found
        ? items.map((x) =>
            x.id === product.id
              ? { ...x, quantity: Math.min(x.quantity + amount, product.stock) }
              : x,
          )
        : [...items, { ...product, quantity: Math.min(amount, product.stock) }];
    });
  const quantity = cart.reduce((sum, x) => sum + x.quantity, 0);
  return (
    <ThemeContext.Provider value={{ settings, setSettings, settingsError }}>
      <AuthContext.Provider value={{ user, login, logout, acceptSession }}>
        <CartContext.Provider value={{ cart, setCart, add, quantity }}>
          {children}
        </CartContext.Provider>
      </AuthContext.Provider>
    </ThemeContext.Provider>
  );
}
function StoreHeader() {
  const { user, logout } = useContext(AuthContext),
    { quantity } = useContext(CartContext),
    { settings } = useContext(ThemeContext);
  const canShop = !user || user.role === "customer" || user.role === "admin";
  return (
    <header className="store-header">
      <a className="brand" href="/">
        {settings?.logoUrl ? (
          <img
            className="store-logo"
            src={settings.logoUrl}
            alt={settings.platformName || "WebMatrix"}
          />
        ) : (
          settings?.platformName || "WebMatrix"
        )}
        <small>SHOP</small>
      </a>
      <nav className="desktop-store-nav">
        <a href="/">Shop</a>
        {user?.role === "customer" && <a href="/customer/orders">My orders</a>}
        {user ? (
          <>
            <a href={rolePath[user.role]}>Dashboard</a>
            <button
              className="link-button"
              onClick={() => {
                logout();
                go("/");
              }}
            >
              Logout
            </button>
          </>
        ) : (
          <a href="/customer/login">Login</a>
        )}
        {canShop && (
          <a className="cart-link" href="/cart">
            Cart <b>{quantity}</b>
          </a>
        )}
      </nav>
      <div className="mobile-store-actions">
        <details className="mobile-store-menu">
          <summary aria-label="Open shop navigation">☰</summary>
          <div>
            <a href="/">Shop</a>
            {user?.role === "customer" && <a href="/customer/orders">My orders</a>}
            {user ? (
              <>
                <a href={rolePath[user.role]}>Dashboard</a>
                <button className="link-button" onClick={() => { logout(); go("/"); }}>Logout</button>
              </>
            ) : (
              <a href="/customer/login">Login</a>
            )}
          </div>
        </details>
        {canShop && (
          <a className="cart-link" href="/cart" aria-label={`Cart with ${quantity} items`}>
            Cart <b>{quantity}</b>
          </a>
        )}
      </div>
    </header>
  );
}
function Store() {
  const [products, setProducts] = useState([]),
    [categories, setCategories] = useState([]),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    { add } = useContext(CartContext),
    { user } = useContext(AuthContext),
    { settings } = useContext(ThemeContext);
  const canShop = !user || user.role === "customer" || user.role === "admin";
  useEffect(() => {
    request("/products")
      .then(setProducts)
      .catch(() => {});
    request("/categories")
      .then(setCategories)
      .catch(() => {});
  }, []);
  const shown = products
    .filter(
      (p) =>
        (!search || p.name.toLowerCase().includes(search.toLowerCase())) &&
        (!category || p.categories?.slug === category),
    )
    .slice(0, Number(settings?.collectionProductLimit || 12));
  return (
    <>
      <StoreHeader />
      <section className="shop-hero">
        <div>
          <span className="eyebrow">CURATED FOR EVERYDAY LIFE</span>
          <h1>
            {settings?.homeHeading || "Thoughtful products. Delivered simply."}
          </h1>
          <p>
            {settings?.homeText ||
              "Discover quality essentials with secure checkout, transparent pricing, and dependable delivery."}
          </p>
          <a
            className="button"
            href="#catalog"
            aria-controls="catalog"
            onClick={(event) => {
              const catalog = document.getElementById("catalog");
              if (!catalog) return;
              event.preventDefault();
              catalog.scrollIntoView({ behavior: "smooth", block: "start" });
              history.replaceState({}, "", `${location.pathname}#catalog`);
            }}
          >
            Shop the collection
          </a>
        </div>
        <div className="hero-orb">
          <span>NEW</span>
          <strong>
            Everyday
            <br />
            Edit
          </strong>
        </div>
      </section>
      <section className="catalog" id="catalog">
        <div className="section-head">
          <div>
            <span className="eyebrow">THE COLLECTION</span>
            <h2>Shop our latest products</h2>
          </div>
          <div className="filters">
            <input
              placeholder="Search products"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="product-grid">
          {shown.map((p) => (
            <article className="product-card" key={p.id}>
              <a className="product-image product-image-link" href={`/product/${p.slug}`} aria-label={`View ${p.name}`}>
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <span>{p.name.slice(0, 1)}</span>
                )}
                {p.is_featured && <em>Featured</em>}
              </a>
              <div className="product-copy">
                <small>{p.categories?.name || "Collection"}</small>
                <h3><a href={`/product/${p.slug}`}>{p.name}</a></h3>
                <p>{p.description || "A considered everyday essential."}</p>
                <div>
                  <strong>{money(p.price)}</strong>
                  {p.compare_at_price && <del>{money(p.compare_at_price)}</del>}
                  {canShop && (
                    <button disabled={!p.stock} onClick={() => add(p)}>
                      {p.stock ? "Add to cart" : "Sold out"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
        {!shown.length && (
          <div className="empty">
            No products found. Super Admin can add the first product from the
            dashboard.
          </div>
        )}
      </section>
      <Footer />
    </>
  );
}
function ProductDetails({ slug }) {
  const [product, setProduct] = useState(null),
    [selectedImage, setSelectedImage] = useState(""),
    [quantity, setQuantity] = useState(1),
    [error, setError] = useState(""),
    { add } = useContext(CartContext),
    { user } = useContext(AuthContext);
  const canShop = !user || user.role === "customer" || user.role === "admin";
  useEffect(() => {
    request(`/products/${encodeURIComponent(slug)}`)
      .then((data) => {
        setProduct(data);
        setSelectedImage(data.image_url || data.images?.[0] || "");
      })
      .catch((err) => setError(err.message));
  }, [slug]);
  if (error)
    return <><StoreHeader /><main className="shop-page product-state"><h1>Product unavailable</h1><p>{error}</p><a className="button" href="/">Return to shop</a></main><Footer /></>;
  if (!product)
    return <><StoreHeader /><main className="shop-page product-state"><h2>Loading product...</h2></main></>;

  const images = [...new Set([product.image_url, ...(product.images || [])].filter(Boolean))],
    discount = product.compare_at_price
      ? Math.round((1 - Number(product.price) / Number(product.compare_at_price)) * 100)
      : 0,
    addSelected = () => add(product, quantity);
  return (
    <>
      <StoreHeader />
      <main className="product-details-page">
        <nav className="breadcrumbs"><a href="/">Home</a><span>›</span><span>{product.categories?.name || "Products"}</span><span>›</span><b>{product.name}</b></nav>
        <section className="product-details">
          <div className="product-gallery">
            {images.length > 1 && <div className="product-thumbnails">{images.map((image) => <button className={selectedImage === image ? "active" : ""} key={image} onClick={() => setSelectedImage(image)}><img src={image} alt={`${product.name} view`} /></button>)}</div>}
            <div className="product-main-image">{selectedImage ? <img src={selectedImage} alt={product.name} /> : <span>{product.name[0]}</span>}</div>
          </div>
          <div className="product-information">
            <span className="eyebrow">{product.categories?.name || "COLLECTION"}</span>
            <h1>{product.name}</h1>
            <div className="rating-row"><b>4.4 ★</b><span>128 ratings &amp; 34 reviews</span></div>
            <div className="detail-price"><strong>{money(product.price)}</strong>{product.compare_at_price && <del>{money(product.compare_at_price)}</del>}{discount > 0 && <em>{discount}% off</em>}</div>
            <p className="tax-note">Inclusive of all taxes</p>
            <div className="offer-box"><h3>Available offers</h3><p>✓ Free delivery on orders above ₹999</p><p>✓ Secure payment and easy order tracking</p><p>✓ 7-day replacement for eligible products</p></div>
            <p className="product-description">{product.description || "A considered everyday essential."}</p>
            <dl className="product-meta"><div><dt>SKU</dt><dd>{product.sku}</dd></div><div><dt>Availability</dt><dd>{product.stock ? `${product.stock} items in stock` : "Sold out"}</dd></div></dl>
            {canShop && (
              <div className="purchase-row">
                <label>Quantity<select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} disabled={!product.stock}>{Array.from({ length: Math.min(product.stock || 0, 10) }, (_, i) => i + 1).map((number) => <option key={number}>{number}</option>)}</select></label>
                <button className="add-cart-action" disabled={!product.stock} onClick={addSelected}>Add to cart</button>
                <button className="buy-now-action" disabled={!product.stock} onClick={() => { addSelected(); go("/checkout"); }}>Buy now</button>
              </div>
            )}
            <div className="delivery-check"><b>Delivery</b><span>Enter your PIN code at checkout to confirm delivery availability.</span></div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
function Cart() {
  const { cart, setCart } = useContext(CartContext);
  const subtotal = cart.reduce((s, x) => s + Number(x.price) * x.quantity, 0);
  return (
    <>
      <StoreHeader />
      <main className="shop-page">
        <div className="section-head">
          <div>
            <span className="eyebrow">YOUR SELECTION</span>
            <h1>Shopping cart</h1>
          </div>
        </div>
        {cart.length ? (
          <div className="cart-layout">
            <section className="cart-items">
              {cart.map((item) => (
                <article key={item.id}>
                  <div className="mini-image">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" />
                    ) : (
                      item.name[0]
                    )}
                  </div>
                  <div>
                    <h3>{item.name}</h3>
                    <p>{money(item.price)}</p>
                  </div>
                  <div className="quantity">
                    <button
                      onClick={() =>
                        setCart((c) =>
                          c.map((x) =>
                            x.id === item.id
                              ? { ...x, quantity: Math.max(1, x.quantity - 1) }
                              : x,
                          ),
                        )
                      }
                    >
                      −
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      onClick={() =>
                        setCart((c) =>
                          c.map((x) =>
                            x.id === item.id
                              ? {
                                  ...x,
                                  quantity: Math.min(x.stock, x.quantity + 1),
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      +
                    </button>
                  </div>
                  <strong>{money(item.price * item.quantity)}</strong>
                  <button
                    className="remove"
                    onClick={() =>
                      setCart((c) => c.filter((x) => x.id !== item.id))
                    }
                  >
                    Remove
                  </button>
                </article>
              ))}
            </section>
            <aside className="summary">
              <h2>Order summary</h2>
              <p>
                <span>Subtotal</span>
                <b>{money(subtotal)}</b>
              </p>
              <p>
                <span>Delivery</span>
                <b>{subtotal >= 999 ? "Free" : money(79)}</b>
              </p>
              <hr />
              <p className="total">
                <span>Total</span>
                <b>{money(subtotal + (subtotal >= 999 ? 0 : 79))}</b>
              </p>
              <button className="button" onClick={() => go("/checkout")}>
                Proceed to checkout
              </button>
            </aside>
          </div>
        ) : (
          <div className="empty">
            <h2>Your cart is empty</h2>
            <a className="button" href="/">
              Continue shopping
            </a>
          </div>
        )}
      </main>
    </>
  );
}
function Checkout() {
  const { user } = useContext(AuthContext),
    { cart, setCart } = useContext(CartContext),
    { settings } = useContext(ThemeContext),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [paymentMethod, setPaymentMethod] = useState("cod"),
    [paymentReference] = useState(() => `WM-PAY-${Date.now().toString(36).toUpperCase()}`);
  const checkoutSubtotal = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0),
    checkoutTotal = checkoutSubtotal + (checkoutSubtotal >= 999 ? 0 : 79),
    upiQuery = settings?.merchantUpiId ? `pa=${encodeURIComponent(settings.merchantUpiId)}&pn=${encodeURIComponent(settings.platformName || "WebMatrix")}&am=${checkoutTotal.toFixed(2)}&cu=INR&tr=${encodeURIComponent(paymentReference)}&tn=${encodeURIComponent(paymentReference)}` : "",
    directUpiUrl = upiQuery ? `upi://pay?${upiQuery}` : "",
    googlePayUrl = upiQuery ? `gpay://upi/pay?${upiQuery}` : "",
    phonePeUrl = upiQuery ? `phonepe://pay?${upiQuery}` : "";
  if (!user) {
    go("/customer/login");
    return null;
  }
  if (user.role === "super_admin") {
    go(rolePath[user.role]);
    return null;
  }
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const items = cart.map((x) => ({ productId: x.id, quantity: x.quantity }));
    const address = {
      fullName: f.fullName, phone: f.phone, line1: f.line1, line2: f.line2,
      city: f.city, state: f.state, postalCode: f.postalCode, country: "India",
    };
    try {
      let order;
      if (paymentMethod === "upi") {
        if (settings?.razorpayConfigured) {
          await loadRazorpayCheckout();
          const gatewayOrder = await request("/payments/razorpay/order", { method: "POST", body: JSON.stringify({ items }) });
          const payment = await new Promise((resolve, reject) => {
            const razorpay = new window.Razorpay({ key: gatewayOrder.keyId, amount: gatewayOrder.amount, currency: gatewayOrder.currency, name: "WebMatrix", description: "WebMatrix shopping order", order_id: gatewayOrder.orderId, prefill: { name: user.name, email: user.email, contact: f.phone }, config: { display: { blocks: { upi: { name: "Pay using UPI", instruments: [{ method: "upi" }] } }, sequence: ["block.upi"], preferences: { show_default_blocks: false } } }, theme: { color: "#18251b" }, handler: resolve, modal: { ondismiss: () => reject(new Error("Payment was cancelled")) } });
            razorpay.on("payment.failed", (response) => reject(new Error(response.error?.description || "UPI payment failed")));
            razorpay.open();
          });
          order = await request("/payments/razorpay/verify", { method: "POST", body: JSON.stringify({ razorpayOrderId: payment.razorpay_order_id, razorpayPaymentId: payment.razorpay_payment_id, razorpaySignature: payment.razorpay_signature, items, address, notes: f.notes }) });
        } else {
          if (!settings?.merchantUpiId) throw new Error("Super Admin must configure a Merchant UPI ID in Store settings");
          order = await request("/orders/manual-upi", { method: "POST", body: JSON.stringify({ items, address, reference: paymentReference, notes: f.notes }) });
        }
      } else {
        order = await request("/orders", { method: "POST", body: JSON.stringify({ items, address, paymentMethod: "cod", notes: f.notes }) });
      }
      setCart([]);
      go(`${user.role === "admin" ? "/admin/orders" : "/customer/orders"}?placed=${order.order_number}`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <StoreHeader />
      <main className="shop-page">
        <div className="section-head">
          <div>
            <span className="eyebrow">SECURE CHECKOUT</span>
            <h1>Delivery details</h1>
          </div>
        </div>
        <form className="checkout-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Full name
              <input name="fullName" defaultValue={user.name} required />
            </label>
            <label>
              Phone
              <input name="phone" required pattern="[0-9+ -]{8,15}" />
            </label>
            <label className="wide">
              Address line 1<input name="line1" required />
            </label>
            <label className="wide">
              Address line 2<input name="line2" />
            </label>
            <label>
              City
              <input name="city" required />
            </label>
            <label>
              State
              <input name="state" required />
            </label>
            <label>
              PIN code
              <input name="postalCode" required />
            </label>
            <label className="wide">
              Order notes
              <textarea name="notes" rows="3" />
            </label>
          </div>
          <div className="payment-box">
            <h2>Payment</h2>
            <label className={paymentMethod === "cod" ? "payment-option selected" : "payment-option"}>
              <input type="radio" name="paymentChoice" value="cod" checked={paymentMethod === "cod"} onChange={() => setPaymentMethod("cod")} />
              <span><b>Cash on delivery</b><small>Pay when your order arrives</small></span>
            </label>
            <label className={paymentMethod === "upi" ? "payment-option selected" : "payment-option"}>
              <input type="radio" name="paymentChoice" value="upi" checked={paymentMethod === "upi"} onChange={() => setPaymentMethod("upi")} />
              <span><b>UPI payment</b><small>Google Pay, PhonePe, Paytm or any UPI app</small></span>
            </label>
            {paymentMethod === "upi" && <div className="upi-payment">
              {settings?.razorpayConfigured ? <p>Razorpay securely opens next. Choose a UPI app on mobile or scan its UPI QR code on desktop.</p> : settings?.merchantUpiId ? <>
                <div className="direct-upi-heading"><small>PAY USING YOUR PHONE</small><strong>Pay {money(checkoutTotal)}</strong><span>Amount and reference {paymentReference} are filled automatically.</span></div>
                <a className="direct-upi-button" href={directUpiUrl}>Pay with any UPI app</a>
                <a className="upi-app-button" href={googlePayUrl}>Google Pay</a>
                <a className="upi-app-button" href={phonePeUrl}>PhonePe</a>
              </> : <p className="error">Super Admin must add a Merchant UPI ID in Store settings.</p>}
            </div>}
            <button className="button" disabled={busy || !cart.length}>
              {busy ? "Placing order…" : "Place order"}
            </button>
            {message && <p className="error">{message}</p>}
          </div>
        </form>
      </main>
    </>
  );
}
function AuthPage({ register = false, customerOnly = false }) {
  const { login } = useContext(AuthContext),
    [error, setError] = useState(""),
    [ok, setOk] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    setError("");
    try {
      if (register) {
        await request("/auth/register", {
          method: "POST",
          body: JSON.stringify(form),
        });
        setOk("Registration successful. Redirecting to login…");
        setTimeout(() => go("/customer/login"), 700);
      } else {
        const user = await login(form.email, form.password);
        go(rolePath[user.role]);
      }
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="auth-page">
      <form className="panel" onSubmit={submit}>
        <a className="brand" href="/">
          Web<span>Matrix</span>
        </a>
        <h2>{register ? "Join WebMatrix" : "Welcome back"}</h2>
        {register && (
          <label>
            Name
            <input name="name" required />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" minLength="8" required />
        </label>
        {error && <p className="error">{error}</p>}
        {ok && <p className="success">{ok}</p>}
        <button className="button">
          {register ? "Create account" : "Login"}
        </button>
        {!register && <a className="forgot-password-link" href="/forgot-password">Forgot password?</a>}
        <p>
          {register
            ? "Already registered?"
            : customerOnly
              ? "New customer?"
              : "Shopping customer?"}{" "}
          <a
            href={
              register
                ? "/customer/login"
                : customerOnly
                  ? "/register"
                  : "/customer/login"
            }
          >
            {register ? "Login" : customerOnly ? "Register" : "Customer login"}
          </a>
        </p>
      </form>
    </div>
  );
}
function ForgotPassword() {
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get("email");
    setBusy(true);
    setError("");
    try {
      const result = await request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <form className="panel" onSubmit={submit}>
        <a className="brand" href="/">Web<span>Matrix</span></a>
        <h2>Reset password</h2>
        <p>Enter your registered email. We will send a secure link that expires in 30 minutes.</p>
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
        <button className="button" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
        <a className="auth-back-link" href="/login">Back to login</a>
      </form>
    </div>
  );
}
function ResetPassword() {
  const token = new URLSearchParams(location.search).get("token") || "";
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setError("");
    if (values.password !== values.confirmPassword) return setError("Passwords do not match");
    setBusy(true);
    try {
      const result = await request("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password: values.password }) });
      setMessage(result.message);
      setTimeout(() => go("/login"), 1200);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <form className="panel" onSubmit={submit}>
        <a className="brand" href="/">Web<span>Matrix</span></a>
        <h2>Create new password</h2>
        {!token && <p className="error">This reset link is missing its security token.</p>}
        <label>New password<input name="password" type="password" minLength="8" required autoComplete="new-password" /></label>
        <label>Confirm password<input name="confirmPassword" type="password" minLength="8" required autoComplete="new-password" /></label>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
        <button className="button" disabled={busy || !token}>{busy ? "Resetting…" : "Reset password"}</button>
        <a className="auth-back-link" href="/login">Back to login</a>
      </form>
    </div>
  );
}
function Shell({ role, children }) {
  const { logout } = useContext(AuthContext),
    { settings } = useContext(ThemeContext);
  return (
    <div className={`app-shell ${role === "customer" ? "customer-shell" : ""}`}>
      <aside>
        <a className="brand" href="/">
          {settings?.platformName || "WebMatrix"}
        </a>
        <p className="role">{role.replace("_", " ")}</p>
        <nav>
          <a href={rolePath[role]}>Overview</a>
          {role !== "customer" && (
            <>
              <a href={`/${role.replace("_", "-")}/products`}>Products</a>
              <a href={`/${role.replace("_", "-")}/orders`}>Orders</a>
            </>
          )}
          {role === "super_admin" && (
            <>
              <a href="/super-admin/settings">Store settings</a>
              <a href="/super-admin/admins">Admins</a>
            </>
          )}
          {role === "customer" && <a href="/customer/orders">My orders</a>}
          <a href="/">View store</a>
        </nav>
        <button
          className="ghost"
          onClick={() => {
            logout();
            go("/");
          }}
        >
          Log out
        </button>
      </aside>
      <header className="mobile-dashboard-header">
        <div>
          <a className="brand" href="/">{settings?.platformName || "WebMatrix"}</a>
          <small>{role.replace("_", " ")}</small>
        </div>
        <details className="mobile-dashboard-menu">
          <summary aria-label="Open dashboard navigation">☰</summary>
          <nav>
            <a href={rolePath[role]}>Overview</a>
            {role !== "customer" && (
              <>
                <a href={`/${role.replace("_", "-")}/products`}>Products</a>
                <a href={`/${role.replace("_", "-")}/orders`}>Orders</a>
              </>
            )}
            {role === "super_admin" && (
              <>
                <a href="/super-admin/settings">Store settings</a>
                <a href="/super-admin/admins">Admins</a>
              </>
            )}
            {role === "customer" && <a href="/customer/orders">My orders</a>}
            <a href="/">View store</a>
            <button onClick={() => { logout(); go("/"); }}>Log out</button>
          </nav>
        </details>
      </header>
      <main>{children}</main>
    </div>
  );
}
function Dashboard({ role }) {
  const { user } = useContext(AuthContext);
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    request(`/dashboard/live?ts=${Date.now()}`, { cache: "no-store" })
      .then((data) => {
        if (!data?.metrics || !Array.isArray(data.recentOrders)) {
          throw new Error("The live dashboard API is still updating. Wait for Render to become Live, then reload this page.");
        }
        setDashboard(data);
      })
      .catch((err) => setError(err.message));
  }, []);
  const welcomeMessage =
    role === "customer"
      ? sessionStorage.getItem("webmatrix_welcome") ||
        `Welcome ${user.name}. Enjoy shopping with WebMatrix.`
      : "Manage your catalog, inventory, customers, and fulfilment.";
  return (
    <Shell role={role}>
      <span className="eyebrow">WEBMATRIX COMMERCE</span>
      <h1>
        {role === "customer" ? `Hello, ${user.name}` : "Commerce overview"}
      </h1>
      <p className="lead">{welcomeMessage}</p>
      {!dashboard && !error && <p className="dashboard-loading">Loading live store data…</p>}
      {error && <p className="error">{error}</p>}
      {dashboard && (
        <>
          <div className="stats operational-stats">
            {(role === "customer"
              ? [
                  ["Total orders", dashboard.metrics.totalOrders],
                  ["Active orders", dashboard.metrics.activeOrders],
                  ["Delivered", dashboard.metrics.completedOrders],
                  ["Total spent", money(dashboard.metrics.totalSpent)],
                ]
              : [
                  ["Revenue collected", money(dashboard.metrics.revenue)],
                  ["Total orders", dashboard.metrics.totalOrders],
                  ["Orders in progress", dashboard.metrics.pendingOrders],
                  ["Active products", dashboard.metrics.products],
                  ["Customers", dashboard.metrics.customers],
                  ["Inventory value", money(dashboard.metrics.inventoryValue)],
                ]
            ).map(([label, value]) => (
              <article key={label}><b>{label}</b><strong>{value}</strong></article>
            ))}
          </div>
          <div className="dashboard-grid">
            <section className="dashboard-panel">
              <div className="dashboard-panel-head">
                <div><span className="eyebrow">LATEST ACTIVITY</span><h2>Recent orders</h2></div>
                <a href={role === "customer" ? "/customer/orders" : `/${role.replace("_", "-")}/orders`}>View all</a>
              </div>
              {dashboard.recentOrders.length ? (
                <div className="dashboard-orders">
                  {dashboard.recentOrders.map((order) => (
                    <article key={order.id}>
                      <div><strong>{order.order_number}</strong><small>{new Date(order.created_at).toLocaleDateString("en-IN")}</small></div>
                      <span className={`status ${order.status}`}>{order.status}</span>
                      <b>{money(order.total)}</b>
                    </article>
                  ))}
                </div>
              ) : <div className="dashboard-empty">No orders yet.</div>}
            </section>
            {role !== "customer" && (
              <section className="dashboard-panel">
                <div className="dashboard-panel-head">
                  <div><span className="eyebrow">INVENTORY</span><h2>Low stock</h2></div>
                  <a href={`/${role.replace("_", "-")}/products`}>Manage</a>
                </div>
                {dashboard.lowStockProducts.length ? (
                  <div className="stock-list">
                    {dashboard.lowStockProducts.map((product) => (
                      <article key={product.id}><div><strong>{product.name}</strong><small>{product.sku}</small></div><b>{product.stock} left</b></article>
                    ))}
                  </div>
                ) : <div className="dashboard-empty">Inventory levels are healthy.</div>}
              </section>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}
function ProductManager({ role }) {
  const [products, setProducts] = useState([]),
    [categories, setCategories] = useState([]),
    [message, setMessage] = useState(""),
    [editingProduct, setEditingProduct] = useState(null);
  const load = () => {
    request("/manage/products").then(setProducts);
    request("/categories").then(setCategories);
  };
  useEffect(() => {
    load();
  }, []);
  const updateProduct = async (product, changes, successMessage) => {
    try {
      setMessage("Updating product...");
      await request(`/manage/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      setMessage(successMessage);
      load();
    } catch (error) {
      setMessage(error.message);
    }
  };
  const removeProduct = async (product) => {
    if (!confirm(`Delete ${product.name} and remove its product card?`)) return;
    try {
      setMessage("Deleting product...");
      await request(`/manage/products/${product.id}`, { method: "DELETE" });
      setMessage("Product card deleted");
      load();
    } catch (error) {
      setMessage(error.message);
    }
  };
  const submitEdit = async (event, product) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const image = formData.get("editImage");
    const changes = {
      name: formData.get("name"),
      price: Number(formData.get("price")),
      stock: Number(formData.get("stock")),
      description: formData.get("description"),
      category_id: formData.get("category_id") || null,
      is_featured: formData.get("is_featured") === "on",
    };
    try {
      setMessage("Saving product changes...");
      if (image instanceof File && image.size) {
        changes.image_url = await uploadImage(image, "products");
      }
      await request(`/manage/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      if (changes.image_url && product.image_url) {
        await deleteImage(product.image_url).catch(() => {});
      }
      setEditingProduct(null);
      setMessage("Product updated successfully");
      load();
    } catch (error) {
      setMessage(error.message);
    }
  };
  const removeProductImage = async (product) => {
    if (!product.image_url || !confirm(`Delete the image for ${product.name}?`))
      return;
    try {
      setMessage("Deleting product image...");
      await deleteImage(product.image_url);
      await request(`/manage/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ image_url: "" }),
      });
      setMessage("Product image deleted");
      load();
    } catch (error) {
      setMessage(error.message);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const image = formData.get("productImage");
    const f = Object.fromEntries(formData);
    delete f.productImage;
    f.price = Number(f.price);
    f.stock = Number(f.stock);
    f.is_featured = formData.get("is_featured") === "on";
    f.is_active = true;
    try {
      if (image instanceof File && image.size) {
        setMessage("Uploading product image...");
        f.image_url = await uploadImage(image, "products");
      }
      await request("/manage/products", {
        method: "POST",
        body: JSON.stringify(f),
      });
      form.reset();
      setMessage("Product created");
      load();
    } catch (err) {
      setMessage(err.message);
    }
  };
  return (
    <Shell role={role}>
      <span className="eyebrow">CATALOG</span>
      <h1>Products</h1>
      <div className="manager-grid">
        <form className="panel settings" onSubmit={submit}>
          <h2>Add product</h2>
          {["name", "slug", "sku", "price", "stock"].map((k) => (
            <label key={k}>
              {k.replace("_", " ")}
              <input
                name={k}
                type={["price", "stock"].includes(k) ? "number" : "text"}
                min="0"
                step={k === "price" ? "0.01" : undefined}
                required={!k.includes("image")}
              />
            </label>
          ))}
          <label className="file-field">
            Product image
            <input
              name="productImage"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
            />
          </label>
          <label>
            Category
            <select name="category_id">
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea name="description" />
          </label>
          <label className="check-field">
            <span>Feature on storefront</span>
            <input name="is_featured" type="checkbox" />
          </label>
          <button className="button">Add product</button>
          {message && <p>{message}</p>}
        </form>
        <section className="data-list">
          {products.map((p) => (
            <article key={p.id}>
              {p.image_url && (
                <div className="manager-image">
                  <img src={p.image_url} alt={p.name} />
                  <button
                    type="button"
                    className="delete-image"
                    title="Delete product image"
                    aria-label={`Delete image for ${p.name}`}
                    onClick={() => removeProductImage(p)}
                  >
                    ×
                  </button>
                </div>
              )}
              <div>
                <b>{p.name}</b>
                <span className="product-badges">
                  {p.is_featured && <em>Featured</em>}
                  <em className={p.is_active ? "active" : "hidden"}>
                    {p.is_active ? "Visible" : "Hidden"}
                  </em>
                </span>
                <small>
                  {p.sku} · Stock {p.stock}
                </small>
              </div>
              <strong>{money(p.price)}</strong>
              <div className="product-actions">
                <button
                  type="button"
                  onClick={() =>
                    setEditingProduct(editingProduct?.id === p.id ? null : p)
                  }
                >
                  {editingProduct?.id === p.id ? "Close edit" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateProduct(
                      p,
                      { is_active: !p.is_active },
                      p.is_active
                        ? "Product hidden from storefront"
                        : "Product visible on storefront",
                    )
                  }
                >
                  {p.is_active ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  className="danger-action"
                  onClick={() => removeProduct(p)}
                >
                  Delete card
                </button>
              </div>
              {editingProduct?.id === p.id && (
                <form
                  className="product-edit-form"
                  onSubmit={(event) => submitEdit(event, p)}
                >
                  <label>
                    Name
                    <input name="name" defaultValue={p.name} required />
                  </label>
                  <label>
                    Price
                    <input
                      name="price"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={p.price}
                      required
                    />
                  </label>
                  <label>
                    Stock
                    <input
                      name="stock"
                      type="number"
                      min="0"
                      defaultValue={p.stock}
                      required
                    />
                  </label>
                  <label>
                    Category
                    <select
                      name="category_id"
                      defaultValue={p.category_id || ""}
                    >
                      <option value="">Uncategorised</option>
                      {categories.map((category) => (
                        <option value={category.id} key={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="edit-feature-check">
                    <input
                      name="is_featured"
                      type="checkbox"
                      defaultChecked={p.is_featured}
                    />
                    Featured product
                  </label>
                  <label>
                    Replace image
                    <input name="editImage" type="file" accept="image/*" />
                  </label>
                  <label className="edit-description">
                    Description
                    <textarea
                      name="description"
                      defaultValue={p.description || ""}
                    />
                  </label>
                  <div className="edit-actions">
                    <button className="button">Save changes</button>
                    <button
                      type="button"
                      onClick={() => setEditingProduct(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </section>
      </div>
    </Shell>
  );
}
function OrderManager({ role }) {
  const [orders, setOrders] = useState([]),
    [paymentFilter, setPaymentFilter] = useState("all"),
    [paymentSearch, setPaymentSearch] = useState("");
  const load = () => request("/manage/orders").then(setOrders);
  useEffect(() => {
    load();
  }, []);
  const change = async (id, status) => {
    await request(`/manage/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    load();
  };
  const refreshPayment = async (id) => {
    await request(`/manage/orders/${id}/payment/refresh`, { method: "POST" });
    load();
  };
  const changePaymentStatus = async (id, status) => {
    await request(`/manage/orders/${id}/payment/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    load();
  };
  const paymentSummary = useMemo(() => ({
    collected: orders.filter((order) => order.payment_status === "paid").reduce((sum, order) => sum + Number(order.gateway_amount ?? order.total), 0),
    paid: orders.filter((order) => order.payment_status === "paid").length,
    pending: orders.filter((order) => order.payment_status === "pending").length,
    attention: orders.filter((order) => ["failed", "refunded"].includes(order.payment_status)).length,
  }), [orders]);
  const visibleOrders = orders.filter((order) => {
    const searchable = [order.order_number, order.gateway_payment_id, order.gateway_reference, order.users?.name, order.users?.email].filter(Boolean).join(" ").toLowerCase();
    return (paymentFilter === "all" || order.payment_status === paymentFilter) && (!paymentSearch || searchable.includes(paymentSearch.toLowerCase()));
  });
  return (
    <Shell role={role}>
      <span className="eyebrow">FULFILMENT</span>
      <h1>Orders</h1>
      <section className="payment-summary-grid">
        <article><small>Total collected</small><strong>{money(paymentSummary.collected)}</strong></article>
        <article><small>Paid orders</small><strong>{paymentSummary.paid}</strong></article>
        <article><small>Pending verification</small><strong>{paymentSummary.pending}</strong></article>
        <article><small>Failed / refunded</small><strong>{paymentSummary.attention}</strong></article>
      </section>
      <div className="payment-filters">
        <input placeholder="Search order, payment ID or UTR" value={paymentSearch} onChange={(e) => setPaymentSearch(e.target.value)} />
        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}><option value="all">All payments</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="refunded">Refunded</option></select>
      </div>
      <section className="orders-list">
        {visibleOrders.map((o) => (
          <article key={o.id}>
            <div>
              <b>{o.order_number}</b>
              <small>
                {o.users?.name} · {new Date(o.created_at).toLocaleDateString()}
              </small>
              <div className="payment-tracking">
                <span className={`payment-state ${o.payment_status}`}>{o.payment_status}</span>
                <span>{o.payment_method === "online" ? (o.gateway_provider || "UPI via Razorpay") : "Cash on delivery"}</span>
                {o.gateway_payment_id && <small>Payment ID: {o.gateway_payment_id}</small>}
                {o.gateway_reference && <small>Payment reference: {o.gateway_reference}</small>}
                {o.gateway_amount != null && <small>Received: {money(o.gateway_amount)}</small>}
                {o.payment_proof_url && <a className="payment-proof-link" href={o.payment_proof_url} target="_blank" rel="noreferrer"><img src={o.payment_proof_url} alt={`Payment proof for ${o.order_number}`} /><span>View payment screenshot</span></a>}
              </div>
            </div>
            <strong>{money(o.total)}</strong>
            {o.gateway_payment_id && <button className="refresh-payment" onClick={() => refreshPayment(o.id)}>Refresh payment</button>}
            {o.gateway_provider === "Direct UPI" && <select value={o.payment_status} onChange={(e) => changePaymentStatus(o.id, e.target.value)} aria-label={`Payment status for ${o.order_number}`}><option value="pending">Payment pending</option><option value="paid">Payment verified</option><option value="failed">Payment failed</option><option value="refunded">Payment refunded</option></select>}
            <select
              value={o.status}
              onChange={(e) => change(o.id, e.target.value)}
            >
              {[
                "placed",
                "confirmed",
                "packed",
                "shipped",
                "delivered",
                "cancelled",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </article>
        ))}
        {!visibleOrders.length && <div className="empty">No payments match this filter.</div>}
      </section>
    </Shell>
  );
}
function MyOrders() {
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    request("/orders/my").then(setOrders);
  }, []);
  return (
    <Shell role="customer">
      <span className="eyebrow">PURCHASES</span>
      <h1>My orders</h1>
      <section className="orders-list">
        {orders.map((o) => (
          <article key={o.id}>
            <div>
              <b>{o.order_number}</b>
              <small>
                {new Date(o.created_at).toLocaleDateString()} ·{" "}
                {o.order_items.length} item(s)
              </small>
              <small>{o.payment_method === "online" ? `${o.gateway_provider || "UPI via Razorpay"} · ${o.payment_status}` : "Cash on delivery"}</small>
            </div>
            <strong>{money(o.total)}</strong>
            <span className={`status ${o.status}`}>{o.status}</span>
          </article>
        ))}
        {!orders.length && (
          <div className="empty">
            No orders yet. <a href="/">Start shopping</a>
          </div>
        )}
      </section>
    </Shell>
  );
}
function Settings() {
  const { settings, setSettings, settingsError } = useContext(ThemeContext),
    [message, setMessage] = useState(""),
    [changeHistory, setChangeHistory] = useState([]),
    [historyError, setHistoryError] = useState("");
  const loadChangeHistory = () =>
    request("/settings/history", { cache: "no-store" })
      .then((rows) => {
        setChangeHistory(rows);
        setHistoryError("");
      })
      .catch((error) => setHistoryError(error.message));
  useEffect(() => {
    loadChangeHistory();
  }, []);
  if (!settings)
    return (
      <Shell role="super_admin">
        <p>{settingsError || "Loading store settings..."}</p>
      </Shell>
    );
  const removeSettingImage = async (field, url, label) => {
    if (!url || !confirm(`Delete the current ${label.toLowerCase()}?`)) return;
    try {
      setMessage(`Deleting ${label.toLowerCase()}...`);
      await deleteImage(url);
      const updated = await request("/settings", {
        method: "PATCH",
        body: JSON.stringify({ [field]: "" }),
      });
      setSettings(updated);
      setMessage(`${label} deleted`);
      loadChangeHistory();
    } catch (error) {
      setMessage(error.message);
    }
  };
  const save = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const values = Object.fromEntries(formData);
    const imageFields = [
      ["logoImage", "logoUrl", "logos"],
      ["bannerImage", "bannerUrl", "banners"],
      ["backgroundImage", "backgroundImageUrl", "backgrounds"],
    ];
    [
      "cardBorderWidth",
      "cardRadius",
      "cardsPerRow",
      "collectionProductLimit",
    ].forEach((k) => (values[k] = Number(values[k])));
    try {
      for (const [inputName, settingName, folder] of imageFields) {
        const image = formData.get(inputName);
        delete values[inputName];
        if (image instanceof File && image.size) {
          setMessage(`Uploading ${inputName.replace("Image", " image")}...`);
          values[settingName] = await uploadImage(image, folder);
        }
      }
      const updated = await request("/settings", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setSettings(updated);
      setMessage("Theme saved. Applying changes…");
      setTimeout(() => location.reload(), 450);
    } catch (err) {
      setMessage(
        err.message === "Access denied"
          ? "Only the Super Admin can save global storefront settings. Log out and sign in with the Super Admin account."
          : err.message,
      );
    }
  };
  const colors = [
    ["storefrontTextColor", "Main font color"],
    ["storefrontBackgroundColor", "Page background"],
    ["headerBackgroundColor", "Header background"],
    ["heroStartColor", "Hero background start"],
    ["heroEndColor", "Hero background end"],
    ["circleColor", "Hero circle color"],
    ["buttonColor", "Button color"],
    ["buttonTextColor", "Button font color"],
    ["collectionBackgroundColor", "Collection background"],
    ["cardBackgroundColor", "Product card color"],
    ["cardBorderColor", "Card border color"],
  ];
  return (
    <Shell role="super_admin">
      <span className="eyebrow">CUSTOMER STOREFRONT</span>
      <h1>Theme & layout</h1>
      <p className="lead">
        Control how every customer-facing shopping page looks without changing
        code.
      </p>
      <form className="theme-editor" onSubmit={save}>
        <section className="theme-section">
          <h2>Brand & content</h2>
          <label>
            Platform name
            <input name="platformName" defaultValue={settings.platformName} />
          </label>
          <label>
            Logo image
            <span className="image-upload">
              <input
                type="hidden"
                name="logoUrl"
                value={settings.logoUrl || ""}
              />
              {settings.logoUrl && (
                <span className="image-preview-wrap">
                  <img src={settings.logoUrl} alt="Current logo" />
                  <button
                    type="button"
                    className="delete-image"
                    title="Delete logo"
                    aria-label="Delete logo"
                    onClick={() =>
                      removeSettingImage("logoUrl", settings.logoUrl, "Logo")
                    }
                  >
                    ×
                  </button>
                </span>
              )}
              <input name="logoImage" type="file" accept="image/*" />
            </span>
          </label>
          <label>
            Banner image
            <span className="image-upload">
              <input
                type="hidden"
                name="bannerUrl"
                value={settings.bannerUrl || ""}
              />
              {settings.bannerUrl && (
                <span className="image-preview-wrap">
                  <img src={settings.bannerUrl} alt="Current banner" />
                  <button
                    type="button"
                    className="delete-image"
                    title="Delete banner"
                    aria-label="Delete banner"
                    onClick={() =>
                      removeSettingImage(
                        "bannerUrl",
                        settings.bannerUrl,
                        "Banner",
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              )}
              <input name="bannerImage" type="file" accept="image/*" />
            </span>
          </label>
          <label>
            Background image
            <span className="image-upload">
              <input
                type="hidden"
                name="backgroundImageUrl"
                value={settings.backgroundImageUrl || ""}
              />
              {settings.backgroundImageUrl && (
                <span className="image-preview-wrap">
                  <img
                    src={settings.backgroundImageUrl}
                    alt="Current background"
                  />
                  <button
                    type="button"
                    className="delete-image"
                    title="Delete background image"
                    aria-label="Delete background image"
                    onClick={() =>
                      removeSettingImage(
                        "backgroundImageUrl",
                        settings.backgroundImageUrl,
                        "Background image",
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              )}
              <input name="backgroundImage" type="file" accept="image/*" />
            </span>
          </label>
          <label>
            Hero heading
            <textarea
              name="homeHeading"
              rows="2"
              defaultValue={settings.homeHeading}
            />
          </label>
          <label>
            Hero description
            <textarea
              name="homeText"
              rows="3"
              defaultValue={settings.homeText}
            />
          </label>
          <label>
            Contact email
            <input
              name="contactEmail"
              type="email"
              defaultValue={settings.contactEmail}
            />
          </label>
          <label>
            Merchant UPI ID
            <input
              name="merchantUpiId"
              placeholder="yourshop@bank"
              pattern="[A-Za-z0-9_.-]{2,}@[A-Za-z0-9_.-]{2,}"
              defaultValue={settings.merchantUpiId || ""}
            />
            <small>Shown to customers in the UPI payment section.</small>
          </label>
        </section>
        <section className="theme-section">
          <h2>Colors</h2>
          <div className="color-grid">
            {colors.map(([name, label]) => (
              <label key={name}>
                <span>{label}</span>
                <input name={name} type="color" defaultValue={settings[name]} />
                <code>{settings[name]}</code>
              </label>
            ))}
          </div>
        </section>
        <section className="theme-section">
          <h2>Typography & borders</h2>
          <label>
            Store font
            <select
              name="storefrontFont"
              defaultValue={settings.storefrontFont}
            >
              <option>DM Sans</option>
              <option>Space Grotesk</option>
              <option>Inter</option>
              <option>Arial</option>
              <option>Georgia</option>
              <option>Verdana</option>
            </select>
          </label>
          <label>
            Card border style
            <select
              name="cardBorderStyle"
              defaultValue={settings.cardBorderStyle}
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="double">Double</option>
              <option value="none">None</option>
            </select>
          </label>
          <label>
            Card border width
            <input
              name="cardBorderWidth"
              type="number"
              min="0"
              max="8"
              defaultValue={settings.cardBorderWidth}
            />
          </label>
          <label>
            Card corner radius
            <input
              name="cardRadius"
              type="number"
              min="0"
              max="60"
              defaultValue={settings.cardRadius}
            />
          </label>
        </section>
        <section className="theme-section">
          <h2>Collection layout</h2>
          <label>
            Cards per row
            <select name="cardsPerRow" defaultValue={settings.cardsPerRow}>
              <option value="2">2 cards</option>
              <option value="3">3 cards</option>
              <option value="4">4 cards</option>
              <option value="5">5 cards</option>
            </select>
          </label>
          <label>
            Products shown in collection
            <input
              name="collectionProductLimit"
              type="number"
              min="1"
              max="100"
              defaultValue={settings.collectionProductLimit}
            />
          </label>
          <div className="theme-preview">
            <div className="preview-circle" />
            <div>
              <b>Live style preview</b>
              <p>
                Button, text, background, border, and circle colors follow your
                choices after saving.
              </p>
              <button type="button">Example button</button>
            </div>
          </div>
        </section>
        <div className="theme-save">
          <button className="button">Save and apply theme</button>
          {message && (
            <p className={message.includes("saved") ? "success" : "error"}>
              {message}
            </p>
          )}
        </div>
      </form>
      <section className="change-history">
        <div className="change-history-head">
          <div>
            <span className="eyebrow">AUDIT HISTORY</span>
            <h2>Website changes</h2>
          </div>
          <button type="button" onClick={loadChangeHistory}>Refresh</button>
        </div>
        {historyError && <p className="error">{historyError}</p>}
        {changeHistory.length ? (
          <div className="change-history-list">
            {changeHistory.map((entry) => {
              const changes = entry.metadata?.field
                ? [[entry.metadata.field, { from: entry.metadata.from, to: entry.metadata.to }]]
                : Object.entries(entry.metadata?.changes || {});
              return (
                <article key={entry.id}>
                  <div className="change-history-meta">
                    <strong>{entry.actor?.name || "Super Admin"}</strong>
                    <span>{new Date(entry.created_at).toLocaleString("en-IN")}</span>
                  </div>
                  <p>{changes.length === 1 ? "Website setting changed" : `${changes.length} website settings changed`}</p>
                  <ul>
                    {changes.map(([field, values]) => (
                      <li key={field}>
                        <b>{field.replaceAll("_", " ")}</b>
                        <span>{String(values.from ?? "Empty")} → {String(values.to ?? "Empty")}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        ) : !historyError && <div className="dashboard-empty">No website changes recorded yet.</div>}
      </section>
    </Shell>
  );
}
function Admins() {
  const [message, setMessage] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = Object.fromEntries(new FormData(formElement));
    form.permissions = ["customer.view", "catalog.manage", "orders.manage"];
    try {
      const admin = await request("/admins", { method: "POST", body: JSON.stringify(form) });
      setMessage(admin.accountUpdated ? "Existing user promoted to Admin successfully" : "Admin created successfully");
      formElement.reset();
    } catch (err) {
      setMessage(err.message);
    }
  };
  return (
    <Shell role="super_admin">
      <h1>Create Admin</h1>
      <form className="panel settings" onSubmit={submit}>
        {["name", "email", "password"].map((k) => (
          <label key={k}>
            {k}
            <input
              name={k}
              type={
                k === "password" ? "password" : k === "email" ? "email" : "text"
              }
              minLength={k === "password" ? 8 : undefined}
              required
            />
          </label>
        ))}
        <p>Permissions: catalog, orders, customers</p>
        <button className="button">Create Admin</button>
        {message && <p>{message}</p>}
      </form>
    </Shell>
  );
}
function Footer() {
  return (
    <footer>
      <div className="brand">
        Web<span>Matrix</span>
      </div>
      <p>Quality products, thoughtfully delivered.</p>
      <small>© {new Date().getFullYear()} WebMatrix Commerce</small>
    </footer>
  );
}
function Router() {
  const { user } = useContext(AuthContext),
    [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname),
      click = (e) => {
        const a = e.target.closest("a");
        if (a?.origin === location.origin) {
          e.preventDefault();
          go(a.pathname);
        }
      };
    addEventListener("popstate", update);
    document.addEventListener("click", click);
    return () => {
      removeEventListener("popstate", update);
      document.removeEventListener("click", click);
    };
  }, []);
  if (path === "/") return <Store />;
  if (path.startsWith("/product/"))
    return <ProductDetails slug={decodeURIComponent(path.slice(9))} />;
  if (path === "/cart" || path === "/checkout") {
    if (user?.role === "super_admin") {
      history.replaceState({}, "", rolePath[user.role]);
      return <Dashboard role={user.role} />;
    }
    return path === "/cart" ? <Cart /> : <Checkout />;
  }
  if (path === "/login") return <AuthPage />;
  if (path === "/customer/login") return <AuthPage customerOnly />;
  if (path === "/register") return <AuthPage register />;
  if (path === "/forgot-password") return <ForgotPassword />;
  if (path === "/reset-password") return <ResetPassword />;
  const role = path.startsWith("/super-admin")
    ? "super_admin"
    : path.startsWith("/admin")
      ? "admin"
      : path.startsWith("/customer")
        ? "customer"
        : null;
  if (!role) {
    history.replaceState({}, "", "/");
    return <Store />;
  }
  if (!user) {
    const loginPath = role === "customer" ? "/customer/login" : "/login";
    history.replaceState({}, "", loginPath);
    return <AuthPage customerOnly={role === "customer"} />;
  }
  if (user.role !== role) {
    history.replaceState({}, "", rolePath[user.role]);
    return <Dashboard role={user.role} />;
  }
  if (path.endsWith("/products")) return <ProductManager role={role} />;
  if (path.endsWith("/orders"))
    return role === "customer" ? <MyOrders /> : <OrderManager role={role} />;
  if (path === "/super-admin/settings") return <Settings />;
  if (path === "/super-admin/admins") return <Admins />;
  return <Dashboard role={role} />;
}
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, message: "" };
  }
  static getDerivedStateFromError(error) {
    return { failed: true, message: error?.message || "Unknown UI error" };
  }
  componentDidCatch(error) {
    console.error("WebMatrix UI error", error);
  }
  render() {
    if (this.state.failed)
      return (
        <div className="recovery-page">
          <div className="panel">
            <a className="brand" href="/">
              Web<span>Matrix</span>
            </a>
            <h2>Let's restore this page</h2>
            <p>WebMatrix could not render this page. Your login is still preserved; reload after reviewing the error below.</p>
            <p className="error">{this.state.message}</p>
            <button className="button" onClick={() => location.reload()}>Reload page</button>
            <button
              className="ghost-recovery"
              onClick={() => location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    return this.props.children;
  }
}
function App() {
  return (
    <AppErrorBoundary>
      <Providers>
        <Router />
      </Providers>
    </AppErrorBoundary>
  );
}
createRoot(document.getElementById("root")).render(<App />);
