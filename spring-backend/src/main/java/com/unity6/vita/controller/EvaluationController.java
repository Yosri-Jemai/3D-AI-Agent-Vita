package com.unity6.vita.controller;

import com.unity6.vita.dto.EvaluationDTO;
import com.unity6.vita.dto.ReponseDTO;
import com.unity6.vita.service.EvaluationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/evaluations")
@RequiredArgsConstructor
public class EvaluationController {

    private final EvaluationService evaluationService;

    @PostMapping("/start")
    public ResponseEntity<EvaluationDTO> startEvaluation(@RequestParam Long profileId) {
        EvaluationDTO evaluation = evaluationService.createEvaluation(profileId);
        return ResponseEntity.status(HttpStatus.CREATED).body(evaluation);
    }

    @PostMapping("/{evaluationId}/reponses")
    public ResponseEntity<ReponseDTO> submitReponse(
            @PathVariable Long evaluationId,
            @RequestParam Long profileId,
            @RequestBody ReponseDTO reponseDTO) {
        ReponseDTO saved = evaluationService.saveReponse(evaluationId, profileId, reponseDTO);
        return ResponseEntity.status(HttpStatus.CREATED).body(saved);
    }

    @PostMapping("/{evaluationId}/finalize")
    public ResponseEntity<EvaluationDTO> finalizeEvaluation(
            @PathVariable Long evaluationId,
            @RequestBody Map<String, String> feedback) {
        EvaluationDTO evaluation = evaluationService.finalizeEvaluation(evaluationId, feedback.get("feedback"));
        return ResponseEntity.ok(evaluation);
    }

    @GetMapping("/profile/{profileId}")
    public ResponseEntity<List<EvaluationDTO>> getProfileEvaluations(@PathVariable Long profileId) {
        List<EvaluationDTO> evaluations = evaluationService.getProfileEvaluations(profileId);
        return ResponseEntity.ok(evaluations);
    }
}