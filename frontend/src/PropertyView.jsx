import React, { useEffect, useState } from "react";
import { MapPin, ExternalLink } from "lucide-react";

/**
 * Street View photo and satellite map of a conveyancing matter's property.
 *
 * The satellite map is Google's keyless map embed. The Street View photo
 * needs a Google Maps API key (VITE_GOOGLE_MAPS_KEY, with the Street View
 * Static API enabled and the key restricted to this site); without one, or
 * where Google has no Street View, there's a button that opens Street View
 * at the property's postcode instead (located via postcodes.io).
 */

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || "";
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

export function postcodeOf(address) {
  const m = String(address || "").match(POSTCODE);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : "";
}

export function PropertyViewCard({ address }) {
  const [view, setView] = useState(MAPS_KEY ? "street" : "satellite");
  const [photoFailed, setPhotoFailed] = useState(false);
  const [coords, setCoords] = useState(null);
  const postcode = postcodeOf(address);
  const q = encodeURIComponent(address);

  // The postcode's position, for the "Open Street View" link.
  useEffect(() => {
    setCoords(null);
    setPhotoFailed(false);
    if (!postcode) return;
    let cancelled = false;
    fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.result) setCoords({ lat: d.result.latitude, lng: d.result.longitude }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [postcode]);

  if (!String(address || "").trim()) return null;

  const streetViewLink = coords
    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coords.lat},${coords.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${q}`;
  const showPhoto = MAPS_KEY && !photoFailed;

  return (
    <div className="ac-card ac-propview">
      <h3><MapPin size={12} /> Property</h3>
      <div className="ac-propview-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === "street"} className={view === "street" ? "on" : ""} onClick={() => setView("street")}>Street View</button>
        <button type="button" role="tab" aria-selected={view === "satellite"} className={view === "satellite" ? "on" : ""} onClick={() => setView("satellite")}>Satellite</button>
      </div>
      <div className="ac-propview-frame">
        {view === "satellite" ? (
          <iframe title={`Satellite view of ${address}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
            src={`https://maps.google.com/maps?q=${q}&t=k&z=19&output=embed`} />
        ) : showPhoto ? (
          <a href={streetViewLink} target="_blank" rel="noreferrer" title="Open in Street View">
            <img alt={`Street View of ${address}`} loading="lazy" onError={() => setPhotoFailed(true)}
              src={`https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${q}&fov=80&source=outdoor&return_error_code=true&key=${MAPS_KEY}`} />
          </a>
        ) : (
          <div className="ac-propview-empty">
            <p>{MAPS_KEY ? "Google has no Street View photo at this address." : "Street View photos appear here once a Google Maps key is set up."}</p>
            <a className="ac-addbtn" href={streetViewLink} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Open Street View{coords ? ` at ${postcode}` : ""}
            </a>
          </div>
        )}
      </div>
      <div className="ac-propview-foot">
        <a href={mapsLink} target="_blank" rel="noreferrer"><ExternalLink size={11} /> Open in Google Maps</a>
        {view === "street" && showPhoto && <span>Nearest Street View photo — check it's the right building.</span>}
      </div>
    </div>
  );
}
