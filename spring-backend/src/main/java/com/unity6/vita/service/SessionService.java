package com.unity6.vita.service;

import com.unity6.vita.dto.*;
import com.unity6.vita.entity.ConversationExtraction;
import com.unity6.vita.entity.InteractionSession;
import com.unity6.vita.repository.ConversationExtractionRepository;
import com.unity6.vita.repository.TrainingSessionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SessionService {

    private final TrainingSessionRepository trainingSessionRepository;
    private final ConversationExtractionRepository extractionRepository;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Value("${python.api.url:http://localhost:8000}")
    private String pythonApiUrl;

    // Start a new session
    public SessionDTO startSession(Long profileId, String mode) {
        InteractionSession session = InteractionSession.builder()
                .profileId(profileId)
                .mode(mode)
                .build();

        InteractionSession saved = trainingSessionRepository.save(session);

        return SessionDTO.builder()
                .id(saved.getId())
                .profileId(saved.getProfileId())
                .sessionUuid(saved.getSessionUuid())
                .mode(saved.getMode())
                .startedAt(saved.getStartedAt())
                .build();
    }

    // End session and extract conversation
    public ExtractionResultDTO endSessionAndExtract(EndSessionRequestDTO request) {
        // 1. Update session end time
        trainingSessionRepository.updateEndTime(request.getSessionId(), LocalDateTime.now());

        // 2. Call Python API to extract conversation
        ExtractionResultDTO extraction = callPythonExtraction(request.getConversation());

        // 3. Save extraction to database
        saveExtraction(request.getSessionId(), request.getProfileId(), extraction);

        return extraction;
    }

    // Call Python FastAPI for extraction
    private ExtractionResultDTO callPythonExtraction(List<ConversationMessageDTO> conversation) {
        String url = pythonApiUrl + "/analytics/extract";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        Map<String, Object> request = new HashMap<>();
        request.put("conversation", conversation);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, headers);

        try {
            Map<String, Object> response = restTemplate.postForObject(url, entity, Map.class);
            if (response != null && Boolean.TRUE.equals(response.get("success"))) {
                Map<String, Object> extraction = (Map<String, Object>) response.get("extraction");

                return ExtractionResultDTO.builder()
                        .products((List<String>) extraction.getOrDefault("products", List.of()))
                        .objections((List<Map<String, Object>>) extraction.getOrDefault("objections", List.of()))
                        .engagementScore((Integer) extraction.getOrDefault("engagement_score", 3))
                        .topics((List<String>) extraction.getOrDefault("topics", List.of()))
                        .language((String) extraction.getOrDefault("language", "unknown"))
                        .recommendations((List<String>) extraction.getOrDefault("recommendations", List.of()))
                        .metadata((Map<String, Object>) extraction.getOrDefault("_metadata", Map.of()))
                        .build();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        // Return default if extraction fails
        return ExtractionResultDTO.builder()
                .products(List.of())
                .objections(List.of())
                .engagementScore(3)
                .topics(List.of())
                .language("unknown")
                .recommendations(List.of("Unable to analyze conversation"))
                .build();
    }

    // Save extraction to database
    private void saveExtraction(Long sessionId, Long profileId, ExtractionResultDTO extraction) {
        try {
            ConversationExtraction entity = ConversationExtraction.builder()
                    .sessionId(sessionId)
                    .profileId(profileId)
                    .products(objectMapper.writeValueAsString(extraction.getProducts()))
                    .objections(objectMapper.writeValueAsString(extraction.getObjections()))
                    .engagementScore(extraction.getEngagementScore())
                    .topics(objectMapper.writeValueAsString(extraction.getTopics()))
                    .language(extraction.getLanguage())
                    .recommendations(objectMapper.writeValueAsString(extraction.getRecommendations()))
                    .build();

            extractionRepository.save(entity);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // Get session history for a profile
    public List<SessionDTO> getSessionHistory(Long profileId) {
        return trainingSessionRepository.findByProfileIdOrderByStartedAtDesc(profileId)
                .stream()
                .map(session -> SessionDTO.builder()
                        .id(session.getId())
                        .profileId(session.getProfileId())
                        .sessionUuid(session.getSessionUuid())
                        .mode(session.getMode())
                        .startedAt(session.getStartedAt())
                        .endedAt(session.getEndedAt())
                        .build())
                .collect(Collectors.toList());
    }

    // Get extraction by session
    public ExtractionResultDTO getExtractionBySession(Long sessionId) {
        return extractionRepository.findBySessionId(sessionId)
                .map(extraction -> {
                    try {
                        return ExtractionResultDTO.builder()
                                .products(objectMapper.readValue(extraction.getProducts(), List.class))
                                .objections(objectMapper.readValue(extraction.getObjections(), List.class))
                                .engagementScore(extraction.getEngagementScore())
                                .topics(objectMapper.readValue(extraction.getTopics(), List.class))
                                .language(extraction.getLanguage())
                                .recommendations(objectMapper.readValue(extraction.getRecommendations(), List.class))
                                .build();
                    } catch (Exception e) {
                        return null;
                    }
                })
                .orElse(null);
    }
}