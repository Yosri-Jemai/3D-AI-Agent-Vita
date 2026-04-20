package com.unity6.vita.controller;

import com.unity6.vita.dto.EndSessionRequestDTO;
import com.unity6.vita.dto.ExtractionResultDTO;
import com.unity6.vita.dto.SessionDTO;
import com.unity6.vita.service.ProfileService;
import com.unity6.vita.service.SessionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/sessions")
@RequiredArgsConstructor
@CrossOrigin(origins = "http://localhost:3000")
public class SessionController {

    private final SessionService sessionService;
    private final ProfileService profileService;

    // Start a new session
    @PostMapping("/start")
    public ResponseEntity<SessionDTO> startSession(@RequestBody Map<String, Object> request) {
        Long profileId = null;
        Object profileIdRaw = request.get("profileId");
        if (profileIdRaw instanceof Number number) {
            profileId = number.longValue();
        } else if (profileIdRaw instanceof String value && !value.isBlank()) {
            try {
                profileId = Long.parseLong(value);
            } catch (NumberFormatException ignored) {
            }
        }
        if (profileId == null) {
            profileId = 2L;
        }
        String mode = String.valueOf(request.getOrDefault("mode", "medical"));

        SessionDTO session = sessionService.startSession(profileId, mode);
        return ResponseEntity.status(HttpStatus.CREATED).body(session);
    }

    // End session and generate report
    @PostMapping("/end")
    public ResponseEntity<ExtractionResultDTO> endSession(@RequestBody EndSessionRequestDTO request) {
        if (request.getProfileId() == null) {
            request.setProfileId(2L);
        }
        ExtractionResultDTO result = sessionService.endSessionAndExtract(request);
        return ResponseEntity.ok(result);
    }

    // Get session history for current user
    @GetMapping("/history")
    public ResponseEntity<List<SessionDTO>> getSessionHistory() {
//        Long profileId = profileService.getCurrentProfile().getId();
        Long profileId = 2L;
        List<SessionDTO> history = sessionService.getSessionHistory(profileId);
        return ResponseEntity.ok(history);
    }

    // Get extraction for a specific session
    @GetMapping("/{sessionId}/extraction")
    public ResponseEntity<ExtractionResultDTO> getExtraction(@PathVariable Long sessionId) {
        ExtractionResultDTO extraction = sessionService.getExtractionBySession(sessionId);
        if (extraction == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(extraction);
    }
}