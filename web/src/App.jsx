import { useEffect, useState } from 'react'
import './App.css'

// SVG の描画領域の一辺(viewBox の単位)。x, y は 0〜1 なので、これを掛けるだけで描ける
const SIZE = 500

// 枠の内側の余白。円(最大半径 7)が枠からはみ出さないよう、点はこの分だけ内側に描く
const PAD = 10

// 異常度がこの値以上なら「最も危ない」とみなして、色と大きさを最大にする
const ANOMALY_MAX = 20

// 異常度を 0〜1 の「危なさ」に変換する。
// 管理限界(1)未満は 0。1 以上は対数で 1〜ANOMALY_MAX を 0〜1 に割り当てる
// (異常度は 150 を超えることもあり、そのままだと一部の機体だけが極端に目立つため)
function dangerLevel(anomaly) {
  if (anomaly < 1) return 0
  return Math.min(Math.log(anomaly) / Math.log(ANOMALY_MAX), 1)
}

// 0〜1 の座標を、余白を除いた PAD〜(SIZE - PAD) の範囲に引き伸ばす。
// x, y に同じ倍率を掛けるので縦横比は保たれる。
// SVG は下向きが正なので、y は反転して上を上として見せる
function toSvgX(x) {
  return PAD + x * (SIZE - 2 * PAD)
}
function toSvgY(y) {
  return PAD + (1 - y) * (SIZE - 2 * PAD)
}

function App() {
  // 読み込んだ data.json 全体。読み込みが終わるまでは null
  const [data, setData] = useState(null)
  // 読み込みに失敗したときのメッセージ
  const [error, setError] = useState(null)
  // いま表示しているサイクル(スライダーで動かす)
  const [t, setT] = useState(1)
  // クリックで選んだエンジンの id。何も選んでいないときは null
  const [selectedId, setSelectedId] = useState(null)

  // 最初の表示のあとに1回だけ data.json を読み込む
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'data.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p>data.json を読み込めませんでした: {error}</p>
  if (!data) return <p>読み込み中…</p>

  // スライダーの最大値 = 一番長生きしたエンジンの寿命
  const maxLife = Math.max(...data.engines.map((e) => e.life))

  // t サイクル目の全エンジンの位置。
  // 故障済み(t > life)のエンジンは、故障した時点(最後のサイクル)の位置に残す
  const points = data.engines.map((e) => {
    const failed = t > e.life
    const i = failed ? e.life - 1 : t - 1
    return {
      id: e.id,
      i,
      failed,
      x: e.x[i],
      y: e.y[i],
      anomaly: e.anomaly[i],
    }
  })

  // SVG は後に描いたものが上に重なるので、
  // 故障済み(グレー)→ 稼働中(異常度の低い順)の順に並べ、危ない機体を一番上に描く
  const runningPoints = points
    .filter((p) => !p.failed)
    .sort((a, b) => a.anomaly - b.anomaly)
  const sortedPoints = [...points.filter((p) => p.failed), ...runningPoints]
  const runningCount = runningPoints.length
  const overLimitCount = runningPoints.filter((p) => p.anomaly >= 1).length

  // 選んだエンジンの、いまの点・元データ・軌跡・ずれの大きい上位3センサー
  const selectedPoint = points.find((p) => p.id === selectedId)
  const selectedEngine = data.engines.find((e) => e.id === selectedId)
  let trajectory = ''
  let topSensors = []
  if (selectedPoint) {
    // サイクル1からいまのサイクルまでの位置を "x1,y1 x2,y2 ..." の形にする(polyline 用)
    trajectory = selectedEngine.x
      .slice(0, selectedPoint.i + 1)
      .map((x, k) => `${toSvgX(x)},${toSvgY(selectedEngine.y[k])}`)
      .join(' ')

    // いまのサイクルのずれ z を、センサー名と組にして絶対値の大きい順に並べ、先頭3つを取る
    topSensors = data.meta.sensors
      .map((name, k) => ({ name, z: selectedEngine.z[selectedPoint.i][k] }))
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, 3)
  }

  // 同じ点をもう一度クリックしたら選択を外す
  function handleClick(id) {
    setSelectedId(id === selectedId ? null : id)
  }

  return (
    <main>
      <h1>エンジン劣化マップ</h1>
      <div className="controls">
        <label>
          サイクル {t}
          <input
            type="range"
            min="1"
            max={maxLife}
            value={t}
            onChange={(event) => setT(Number(event.target.value))}
          />
        </label>
        <span>
          稼働中 {runningCount} 台(うち管理限界超え {overLimitCount} 台)/
          故障済み {points.length - runningCount} 台
        </span>
      </div>
      <p className="legend">
        <span className="swatch normal" /> 正常範囲
        <span className="swatch warn" /> 管理限界超え
        <span className="swatch danger" /> 大きく超過(大きく赤いほど危ない)
        <span className="swatch failed" /> 故障済み
      </p>
      <div className="layout">
        <svg className="map" viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <rect className="frame" x="0" y="0" width={SIZE} height={SIZE} />
          {sortedPoints.map((p) => {
            // 半径は管理限界未満なら 4、超えたら 4.5〜7 で少しずつ大きくする。
            // 故障済みの点も故障直前の異常度で計算するので、故障の瞬間に大きさは変わらない
            const level = dangerLevel(p.anomaly)
            const r = p.anomaly < 1 ? 4 : 4.5 + 2.5 * level
            const cx = toSvgX(p.x)
            const cy = toSvgY(p.y)

            if (p.failed) {
              return (
                <circle
                  key={p.id}
                  className="engine failed"
                  cx={cx}
                  cy={cy}
                  r={r}
                  onClick={() => handleClick(p.id)}
                />
              )
            }

            // 管理限界未満は青灰色、超えたら オレンジ → 赤 に変わる
            const fill =
              p.anomaly < 1
                ? '#7c8aa5'
                : `hsl(${35 - 35 * level}, 90%, ${55 - 13 * level}%)`

            return (
              <circle
                key={p.id}
                className="engine"
                cx={cx}
                cy={cy}
                r={r}
                fill={fill}
                onClick={() => handleClick(p.id)}
              />
            )
          })}

          {/* 選んだエンジンの軌跡と、いまの位置を示す輪。点に隠れないよう最後に描く
              (クリックは CSS の pointer-events: none で下の点に通す) */}
          {selectedPoint && (
            <>
              <polyline className="trajectory" points={trajectory} />
              <circle
                className="selected-ring"
                cx={toSvgX(selectedPoint.x)}
                cy={toSvgY(selectedPoint.y)}
                r="11"
              />
            </>
          )}
        </svg>

        <aside className="detail">
          {selectedPoint ? (
            <>
              <h2>エンジン #{selectedPoint.id}</h2>
              <p>
                {selectedPoint.failed
                  ? `故障済み(サイクル ${selectedEngine.life} で故障)`
                  : '稼働中'}
              </p>
              <p>
                異常度 {selectedPoint.anomaly.toFixed(2)}
                {selectedPoint.anomaly >= 1 ? '(管理限界超え)' : '(正常範囲)'}
              </p>
              <h3>正常時からのずれが大きいセンサー</h3>
              <ol>
                {topSensors.map((s) => (
                  <li key={s.name}>
                    {s.name}: {s.z > 0 ? '高い' : '低い'}(
                    {s.z > 0 ? '+' : ''}
                    {s.z.toFixed(1)}σ)
                  </li>
                ))}
              </ol>
              <button type="button" onClick={() => setSelectedId(null)}>
                選択を解除
              </button>
            </>
          ) : (
            <p>点をクリックすると、そのエンジンの軌跡と原因になっていそうなセンサーを表示します。</p>
          )}
        </aside>
      </div>
    </main>
  )
}

export default App
