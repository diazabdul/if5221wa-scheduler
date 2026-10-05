package driver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/ghazlabs/wa-scheduler/internal/core"
	"github.com/stretchr/testify/assert"
)

type mockService struct{}

func (m *mockService) InitializeService(ctx context.Context) {}

func (m *mockService) GetAllMessages(ctx context.Context, input core.GetAllMessagesInput) ([]core.Message, error) {
	if input.Status == "" {
		return []core.Message{
			{ID: "test-1", Status: core.MessageStatusFailed},
			{ID: "test-2", Status: core.MessageStatusSent},
			{ID: "test-3", Status: core.MessageStatusScheduled},
		}, nil
	}
	return []core.Message{
		{ID: "test-1", Status: input.Status},
		{ID: "test-2", Status: input.Status},
	}, nil
}

func (m *mockService) SendMessage(ctx context.Context, input core.ScheduleMessageInput) error {
	return nil
}

func (m *mockService) RetryMessage(ctx context.Context, input core.RetryMessageInput) error {
	return nil
}

func newTestAPI() *API {
	api, _ := NewAPI(APIConfig{
		Service:            &mockService{},
		ClientUsername:     "admin",
		ClientPassword:     "admin",
		WebClientPublicDir: ".",
	})
	return api
}

func parseBody(w *httptest.ResponseRecorder) map[string]interface{} {
	var body map[string]interface{}
	json.NewDecoder(w.Body).Decode(&body)
	return body
}

func TestGetAllMessages(t *testing.T) {
	testCases := []struct {
		name              string
		query             string
		expectedStatus    int
		expectedOk        bool
		expectedMsgStatus string
		expectedError     bool
	}{
		{
			name:              "should return 200 with failed messages when status = failed",
			query:             "/messages?status=failed",
			expectedStatus:    http.StatusOK,
			expectedOk:        true,
			expectedMsgStatus: string(core.MessageStatusFailed),
		},
		{
			name:              "should return 200 with scheduled messages when status = scheduled",
			query:             "/messages?status=scheduled",
			expectedStatus:    http.StatusOK,
			expectedOk:        true,
			expectedMsgStatus: string(core.MessageStatusScheduled),
		},
		{
			name:              "should return 200 sent messages when status = sent",
			query:             "/messages?status=sent",
			expectedStatus:    http.StatusOK,
			expectedOk:        true,
			expectedMsgStatus: string(core.MessageStatusSent),
		},
		{
			name:           "should return 400 when status is invalid",
			query:          "/messages?status=invalid",
			expectedStatus: http.StatusBadRequest,
			expectedOk:     false,
			expectedError:  true,
		},
		{
			name:           "should return 200 with all messages when no status filter",
			query:          "/messages",
			expectedStatus: http.StatusOK,
			expectedOk:     true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			api := newTestAPI()

			req := httptest.NewRequest(http.MethodGet, tc.query, nil)
			req.SetBasicAuth("admin", "admin")
			w := httptest.NewRecorder()

			api.serveGetMessages(w, req)

			body := parseBody(w)

			assert.Equal(t, tc.expectedStatus, w.Code)
			assert.Equal(t, tc.expectedOk, body["ok"].(bool))

			if tc.expectedError {
				assert.NotNil(t, body["err"])
				return
			}

			data, ok := body["data"].([]interface{})
			assert.True(t, ok)
			assert.NotEmpty(t, data)

			if tc.expectedMsgStatus != "" {
				for _, item := range data {
					msg := item.(map[string]interface{})
					assert.Equal(t, tc.expectedMsgStatus, msg["status"])
				}
			}
		})
	}
}

func TestServeWebFrontendAssets(t *testing.T) {
	webDir := t.TempDir()
	assetsDir := filepath.Join(webDir, "assets")
	if err := os.Mkdir(assetsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	files := map[string]string{
		filepath.Join(webDir, "index.html"):   `<script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">`,
		filepath.Join(assetsDir, "app.js"):    "window.previewReady = true;",
		filepath.Join(assetsDir, "shared.js"): "window.sharedReady = true;",
		filepath.Join(assetsDir, "app.css"):   "body { color: green; }",
	}
	for path, contents := range files {
		if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	api, err := NewAPI(APIConfig{
		Service:            &mockService{},
		ClientUsername:     "admin",
		ClientPassword:     "admin",
		WebClientPublicDir: webDir,
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, testCase := range []struct {
		path string
		want string
	}{
		{path: "/", want: `/assets/app.js`},
		{path: "/assets/app.js", want: "window.previewReady = true;"},
		{path: "/assets/shared.js", want: "window.sharedReady = true;"},
		{path: "/assets/app.css", want: "body { color: green; }"},
	} {
		t.Run(testCase.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			api.GetHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, testCase.path, nil))

			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.Contains(t, recorder.Body.String(), testCase.want)
		})
	}
}
