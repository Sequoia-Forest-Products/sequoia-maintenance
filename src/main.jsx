import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import App, { TVBoard } from "./App.jsx";

const CLIENT_ID = "991806177035-4icb3cllat3m6rhul5jovjkhjdcrjqd0.apps.googleusercontent.com";

function AuthGate() {
  const [idToken,     setIdToken]     = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [user,        setUser]        = useState(null);
  const [error,       setError]       = useState(null);
  const [loading,     setLoading]     = useState(true);

  const handleCredential = useCallback((response) => {
    const token  = response.credential;
    const claims = JSON.parse(atob(token.split(".")[1]));
    const allowed = (import.meta.env.VITE_ALLOWED_EMAILS || "peter.stroble@gmail.com").split(",").map(e=>e.trim()).filter(Boolean);
    const domain  = "sequoiafp.com";
    const ok = claims.email?.endsWith("@"+domain) || allowed.includes(claims.email);
    if (!ok) { setError("Access restricted to Sequoia Forest Products accounts."); return; }
    setIdToken(token);
    setUser({ email: claims.email, name: claims.name, picture: claims.picture });
    window.__sfpCtx = { idToken: token, user: { name: claims.name, email: claims.email } };
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => {
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: handleCredential, auto_select: true });
      window.google.accounts.id.prompt((n) => {
        if (n.isNotDisplayed() || n.isSkippedMoment()) setLoading(false);
      });
    };
    document.head.appendChild(script);
  }, [handleCredential]);

  if (idToken) return <App user={user} idToken={idToken} accessToken={accessToken}/>;

  const B = { bg:"#27211E", rust:"#AD4C25", orange:"#EE7425", cream:"#EAD9CA", text:"#F5F0EB" };
  return (
    <div style={{minHeight:"100vh",background:B.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Montserrat,Arial,sans-serif"}}>
      <div style={{background:"#2E2622",borderRadius:12,padding:40,maxWidth:380,width:"90%",textAlign:"center",border:`1px solid #3A3028`}}>
        <div style={{color:B.orange,fontWeight:800,fontSize:11,letterSpacing:2,marginBottom:8}}>SEQUOIA FOREST PRODUCTS</div>
        <div style={{color:B.text,fontWeight:700,fontSize:24,marginBottom:4}}>Maintenance System</div>
        <div style={{color:B.cream,fontSize:13,marginBottom:28,opacity:0.7}}>Work Planner</div>
        <div style={{background:B.rust,height:2,width:48,margin:"0 auto 28px",borderRadius:1}}/>
        {error && <div style={{color:"#FF8870",fontSize:13,marginBottom:16,padding:"10px 14px",background:"rgba(173,76,37,0.15)",borderRadius:6}}>{error}</div>}
        {loading
          ? <div style={{color:B.cream,fontSize:13,opacity:0.6}}>Signing in…</div>
          : <div id="g_id_signin" style={{display:"inline-block"}}
              ref={el => { if(el && window.google) window.google.accounts.id.renderButton(el,{theme:"filled_black",size:"large",text:"signin_with",shape:"pill"}); }}/>
        }
      </div>
    </div>
  );
}

// Read-only TV wall display at /tv (or #tv) — skips sign-in since a TV can't log in
const isTV = window.location.pathname.replace(/\/+$/,"") === "/tv" || window.location.hash === "#tv";
createRoot(document.getElementById("root")).render(isTV ? <TVBoard/> : <AuthGate/>);
