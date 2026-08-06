package com.agentbazaar.sdk;

import org.json.JSONObject;

/**
 * Thrown for non-2xx API responses (except HTTP 402, which is surfaced as
 * {@link PaymentRequiredException}).
 */
public class ApiException extends RuntimeException {

    private final int statusCode;
    private final JSONObject data;

    public ApiException(int statusCode, String message, JSONObject data) {
        super(message == null || message.isBlank()
                ? "agentbazaar: HTTP " + statusCode
                : "agentbazaar: HTTP " + statusCode + ": " + message);
        this.statusCode = statusCode;
        this.data = data;
    }

    /** HTTP status code returned by the platform. */
    public int getStatusCode() {
        return statusCode;
    }

    /** Decoded response body, or {@code null} when the body was not JSON. */
    public JSONObject getData() {
        return data;
    }
}
