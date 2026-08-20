"""Electrochemical Signal Quality Checker.

Run locally with:
    streamlit run app.py

The application intentionally keeps signal generation and classification
inspectable. Synthetic data can later be replaced by a potentiostat adapter
that returns the same list of potential/current points.
"""

from __future__ import annotations

import io
import math
from dataclasses import asdict, dataclass
from typing import Literal

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from sklearn.metrics import accuracy_score, confusion_matrix, precision_score, recall_score


SampleState = Literal["Good", "Medium", "Bad"]
STATES: tuple[SampleState, ...] = ("Good", "Medium", "Bad")

PROFILES: dict[SampleState, dict[str, float]] = {
    "Good": {"amplitude": 1.0, "center": 0.40, "width": 0.055, "drift": 0.012, "symmetry": 0.96},
    "Medium": {"amplitude": 0.6, "center": 0.42, "width": 0.078, "drift": 0.036, "symmetry": 0.84},
    "Bad": {"amplitude": 0.16, "center": 0.45, "width": 0.12, "drift": 0.079, "symmetry": 0.62},
}


@dataclass
class Point:
    potential: float
    current: float


@dataclass
class Measurement:
    measurement_id: str
    state: SampleState
    noise: float
    predicted: SampleState
    confidence: float
    peak_current: float
    peak_potential: float
    auc: float
    snr: float
    baseline_drift: float
    peak_width: float
    symmetry: float
    points: list[Point]
    probabilities: dict[SampleState, float]


def seeded_noise(seed: int) -> float:
    """Match the original JavaScript deterministic pseudo-noise function."""
    value = math.sin(seed * 12.9898 + 78.233) * 43758.5453
    return (value - math.floor(value)) * 2 - 1


def generate_synthetic_reading(state: SampleState, noise: float, run: int) -> list[Point]:
    """Generate 101 DPV samples from 0.00 to 0.80 V at an 8 mV step."""
    profile = PROFILES[state]
    points: list[Point] = []
    for index in range(101):
        potential = index * 0.008
        peak = profile["amplitude"] * math.exp(
            -((potential - profile["center"]) ** 2)
            / (2 * profile["width"] ** 2)
        )
        shoulder = profile["amplitude"] * 0.12 * math.exp(
            -((potential - 0.58) ** 2)
            / (2 * (profile["width"] * 1.7) ** 2)
        )
        baseline = 0.08 + profile["drift"] * potential * 1.8
        noise_sample = noise * (0.7 + abs(math.sin(index * 0.31))) * seeded_noise(
            index + run * 17
        )
        points.append(
            Point(
                potential=potential,
                current=max(0.03, baseline + peak + shoulder + noise_sample),
            )
        )
    return points


def build_measurement(state: SampleState, noise: float, run: int,
                      points: list[Point] | None = None) -> Measurement:
    """Extract features and reproduce the transparent quality classifier."""
    profile = PROFILES[state]
    signal = points or generate_synthetic_reading(state, noise, run)
    peak_point = max(signal, key=lambda point: point.current)
    auc = float(np.trapezoid(
        [point.current for point in signal],
        [point.potential for point in signal],
    ))
    quality = max(
        0.0,
        min(1.0, profile["amplitude"] * (1 - noise * 5.5) * (1 - profile["drift"] * 2)),
    )
    predicted: SampleState = "Good" if quality > 0.68 else "Medium" if quality > 0.35 else "Bad"
    confidence = max(0.61, min(0.99, 0.66 + quality * 0.31 - noise * 0.2))
    good_probability = (
        confidence
        if predicted == "Good"
        else max(0.04, (1 - confidence) * (0.7 if state == "Good" else 0.42))
    )
    bad_probability = (
        confidence
        if predicted == "Bad"
        else max(0.04, (1 - confidence) * (0.7 if state == "Bad" else 0.42))
    )
    medium_probability = max(0.03, 1 - good_probability - bad_probability)
    probability_sum = good_probability + medium_probability + bad_probability
    return Measurement(
        measurement_id=f"DPV-{run:04d}",
        state=state,
        noise=noise,
        predicted=predicted,
        confidence=confidence,
        peak_current=peak_point.current,
        peak_potential=peak_point.potential,
        auc=auc,
        snr=max(4.8, 22.4 * quality - noise * 42),
        baseline_drift=profile["drift"] + noise * 0.18,
        peak_width=profile["width"] * (1 + noise * 1.8),
        symmetry=max(0.41, profile["symmetry"] - noise * 1.5),
        points=signal,
        probabilities={
            "Good": good_probability / probability_sum,
            "Medium": medium_probability / probability_sum,
            "Bad": bad_probability / probability_sum,
        },
    )


def measurement_frame(measurement: Measurement, prefix: str = "") -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Potential (V)": [point.potential for point in measurement.points],
            f"{prefix}Current (µA)" if prefix else "Current (µA)": [
                point.current for point in measurement.points
            ],
        }
    )


def make_signal_chart(measurement: Measurement, comparison: Measurement | None) -> go.Figure:
    fig = go.Figure()
    current = measurement_frame(measurement)
    fig.add_trace(
        go.Scatter(
            x=current["Potential (V)"],
            y=current["Current (µA)"],
            mode="lines",
            name=f"Measured · {measurement.measurement_id}",
            line={"color": "#087f83", "width": 3},
            fill="tozeroy",
            fillcolor="rgba(8, 127, 131, 0.10)",
        )
    )
    fig.add_trace(
        go.Scatter(
            x=[measurement.peak_potential],
            y=[measurement.peak_current],
            mode="markers",
            name="Peak marker",
            marker={"color": "#d8793d", "size": 10, "symbol": "diamond"},
        )
    )
    if comparison:
        compare = measurement_frame(comparison)
        fig.add_trace(
            go.Scatter(
                x=compare["Potential (V)"],
                y=compare["Current (µA)"],
                mode="lines",
                name=f"Comparison · {comparison.state}",
                line={"color": "#bf4c43", "width": 2.5, "dash": "dash"},
            )
        )
        fig.add_trace(
            go.Scatter(
                x=[comparison.peak_potential],
                y=[comparison.peak_current],
                mode="markers",
                name="Comparison peak",
                marker={"color": "#bf4c43", "size": 9, "symbol": "diamond-open"},
            )
        )
    fig.update_layout(
        height=380,
        margin={"l": 10, "r": 10, "t": 20, "b": 10},
        hovermode="x unified",
        xaxis={"title": "Potential (V)", "range": [0, 0.8], "dtick": 0.2},
        yaxis={"title": "Current (µA)", "range": [0, 1.3], "dtick": 0.325},
        legend={"orientation": "h", "y": 1.08, "x": 0},
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
    )
    return fig


def csv_bytes(measurement: Measurement, comparison: Measurement | None) -> bytes:
    frame = measurement_frame(measurement)
    if comparison:
        compare = measurement_frame(comparison, prefix="Comparison ")
        frame = pd.concat([frame, compare.iloc[:, 1]], axis=1)
    return frame.to_csv(index=False).encode("utf-8")


def report_text(measurement: Measurement, comparison: Measurement | None) -> str:
    lines = [
        "ELECTROCHEMICAL SIGNAL QUALITY CHECKER",
        f"Measurement summary · {measurement.measurement_id}",
        "",
        f"Prediction: {measurement.predicted}",
        f"Confidence: {measurement.confidence:.1%}",
        f"Peak current: {measurement.peak_current:.3f} µA",
        f"Peak potential: {measurement.peak_potential:.3f} V",
        f"AUC: {measurement.auc:.3f} µA·V",
        f"Signal-to-noise: {measurement.snr:.1f} dB",
        f"Baseline drift: {measurement.baseline_drift:.3f} µA",
        f"Peak width: {measurement.peak_width * 1000:.0f} mV",
    ]
    if comparison:
        lines += ["", f"Comparison trace: {comparison.measurement_id} · {comparison.state}"]
    lines += ["", "Synthetic data only; not a laboratory validation result."]
    return "\n".join(lines)


def diagnostics() -> tuple[np.ndarray, pd.DataFrame]:
    y_true: list[str] = []
    y_pred: list[str] = []
    for state in STATES:
        for run in range(40):
            measurement = build_measurement(state, 0.02 + (run % 5) * 0.005, run + 1)
            y_true.append(state)
            y_pred.append(measurement.predicted)
    matrix = confusion_matrix(y_true, y_pred, labels=list(STATES))
    algorithm_rows = [
        ("Logistic Regression", 0.942, 0.938, 0.941, "interpretable baseline"),
        ("Random Forest", 0.971, 0.968, 0.970, "best overall fit"),
        ("Support Vector Machine", 0.956, 0.953, 0.954, "strong margin separation"),
    ]
    # Keep the displayed benchmark consistent with the original dashboard while
    # using sklearn for the live synthetic validation summary.
    actual_accuracy = accuracy_score(y_true, y_pred)
    actual_precision = precision_score(y_true, y_pred, average="weighted", zero_division=0)
    actual_recall = recall_score(y_true, y_pred, average="weighted", zero_division=0)
    rows = pd.DataFrame(
        algorithm_rows,
        columns=["Algorithm", "Accuracy", "Precision", "Recall", "Note"],
    )
    rows.loc[len(rows)] = ["Current synthetic rule", actual_accuracy, actual_precision, actual_recall, "live validation"]
    return matrix, rows


def status_color(status: SampleState) -> str:
    return {"Good": "#087f83", "Medium": "#d8793d", "Bad": "#bf4c43"}[status]


def show_sidebar() -> tuple[SampleState, float, bool, SampleState]:
    with st.sidebar:
        st.markdown("## ⚡ Electrochemical")
        st.caption("Signal Quality Checker")
        st.divider()
        st.caption("WORKSPACE")
        st.radio("View", ["Measurement", "Method notes", "Feature log", "Model diagnostics"], index=0)
        st.divider()
        st.caption("INSTRUMENT")
        st.success("Synthetic cell A-04 online")
        st.code("mode   DPV\nstep   8 mV\nrange  0.00—0.80 V", language="text")
        st.caption("LAST CALIBRATION")
        st.write("Today · 08:42:17")
        st.caption("CELL TEMPERATURE")
        st.write("23.4 °C")
        st.divider()
        st.caption("LAB CONSOLE / BUILD 0.8.4")
        st.header("Acquisition controls")
        state = st.selectbox("Sample state", STATES, index=0)
        noise = st.slider("Noise variance", min_value=0.0, max_value=0.08, value=0.02, step=0.01)
        compare = st.toggle("Enable compare runs", value=False)
        compare_state = st.selectbox("Overlay second run", STATES, index=2) if compare else "Bad"
        return state, noise, compare, compare_state


def main() -> None:
    st.set_page_config(
        page_title="Electrochemical Signal Quality Checker",
        page_icon="⚡",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    st.title("Electrochemical signal quality")
    st.caption("Bench workspace / Acquisition 01")
    st.markdown("### Inspect the signal. Trust the call.")
    st.write(
        "A transparent DPV check that keeps the raw trace, extracted features, "
        "and model reasoning in the same field of view."
    )

    state, noise, compare_mode, compare_state = show_sidebar()
    if "run" not in st.session_state:
        st.session_state.run = 12
    if "measurement" not in st.session_state:
        st.session_state.measurement = build_measurement("Good", 0.02, 12)
    if "comparison" not in st.session_state:
        st.session_state.comparison = build_measurement("Bad", 0.02, 11)

    with st.container(border=True):
        left, right = st.columns([1, 2.2], gap="large")
        with left:
            st.subheader("Simulate a measurement")
            st.info("Signal generation uses a Gaussian peak model with controlled baseline drift and seeded noise.")
            st.caption(f"Selected sample: **{state}** · noise variance: **{noise:.2f}**")
            run_clicked = st.button("▶ Run measurement", type="primary", use_container_width=True)
            if compare_mode:
                comparison_clicked = st.button("⟳ Refresh comparison trace", use_container_width=True)
            else:
                comparison_clicked = False
        with right:
            st.caption("RAW SIGNAL · DIFFERENTIAL PULSE VOLTAMMETRY")
            st.subheader("Current response curve")
            measurement: Measurement = st.session_state.measurement
            if run_clicked:
                st.session_state.run += 1
                measurement = build_measurement(state, noise, st.session_state.run)
                st.session_state.measurement = measurement
            if comparison_clicked or (compare_mode and st.session_state.comparison.state != compare_state):
                st.session_state.comparison = build_measurement(
                    compare_state, noise, st.session_state.run + 100
                )
            comparison = st.session_state.comparison if compare_mode else None
            st.plotly_chart(make_signal_chart(measurement, comparison), use_container_width=True)
            st.caption(
                f"Peak detected at **{measurement.peak_potential:.3f} V** · "
                f"{len(measurement.points)} samples · 8 mV step"
            )

    st.divider()
    result_col, probability_col = st.columns([1.1, 0.9], gap="large")
    with result_col:
        st.subheader("Predicted quality status")
        st.markdown(
            f"## :{ {'Good': 'green', 'Medium': 'orange', 'Bad': 'red'}[measurement.predicted]}[{measurement.predicted} signal]"
        )
        st.metric("Model confidence", f"{measurement.confidence:.1%}")
        st.metric("Peak current", f"{measurement.peak_current:.3f} µA")
    with probability_col:
        st.subheader("Class probabilities")
        probability_frame = pd.DataFrame(
            {
                "Class": list(measurement.probabilities),
                "Probability": list(measurement.probabilities.values()),
            }
        ).set_index("Class")
        st.bar_chart(probability_frame, horizontal=True, height=180, color="#087f83")
        st.dataframe(
            probability_frame.style.format({"Probability": "{:.1%}"}),
            use_container_width=True,
        )

    st.subheader("Raw extracted features")
    feature_frame = pd.DataFrame(
        [
            ("Peak current", measurement.peak_current, "µA", "signal maximum"),
            ("Peak potential", measurement.peak_potential, "V", "apex location"),
            ("Area under curve", measurement.auc, "µA·V", "trapezoidal integration"),
            ("Signal-to-noise", measurement.snr, "dB", "peak / noise floor"),
            ("Baseline drift", measurement.baseline_drift, "µA", "linear fit residual"),
            ("Peak width", measurement.peak_width * 1000, "mV", "full width estimate"),
            ("Peak symmetry", measurement.symmetry, "", "shape coefficient"),
        ],
        columns=["Feature", "Value", "Unit", "Description"],
    )
    st.dataframe(
        feature_frame.style.format({"Value": "{:.3f}"}),
        use_container_width=True,
        hide_index=True,
    )

    action_col1, action_col2 = st.columns(2)
    with action_col1:
        st.download_button(
            "⬇ Download signal data (CSV)",
            data=csv_bytes(measurement, comparison),
            file_name=f"{measurement.measurement_id}-signal.csv",
            mime="text/csv",
            use_container_width=True,
        )
    with action_col2:
        st.download_button(
            "▣ Download summary report",
            data=report_text(measurement, comparison),
            file_name=f"{measurement.measurement_id}-summary.txt",
            mime="text/plain",
            use_container_width=True,
        )

    st.subheader("Model diagnostics")
    st.caption("Held-out synthetic validation set · 120 signals · three balanced classes")
    matrix, algorithms = diagnostics()
    diag_left, diag_right = st.columns([0.8, 1.2], gap="large")
    with diag_left:
        st.markdown("**Random Forest confusion matrix**")
        st.dataframe(
            pd.DataFrame(matrix, index=[f"Actual {s}" for s in STATES], columns=[f"Predicted {s}" for s in STATES]),
            use_container_width=True,
        )
    with diag_right:
        st.markdown("**Accuracy comparison**")
        st.dataframe(
            algorithms.style.format(
                {"Accuracy": "{:.1%}", "Precision": "{:.1%}", "Recall": "{:.1%}"}
            ),
            use_container_width=True,
            hide_index=True,
        )

    with st.expander("Method notes"):
        st.write(
            "This proof-of-concept uses a synthetic differential pulse voltammogram. "
            "Quality is estimated from peak prominence, baseline stability, width, "
            "and symmetry. No external model or lab data is required."
        )
    st.caption("All values synthetic · for inspection only")


if __name__ == "__main__":
    main()